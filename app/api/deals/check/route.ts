import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { evaluateDeal } from "@/lib/engine/verdict";
import {
  checkEligibility,
  spApiConfigFromEnv,
  EligibilityCache,
} from "@/lib/engine/eligibility";
import { getLiveSellPrice } from "@/lib/spapi/pricing";
import {
  canCreateIntent,
  capsFromEnv,
  killSwitchFromEnv,
  sharedMemoryStore,
  startOfUtcDay,
  supabaseIsConfigured,
  type SpendUsage,
} from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";

// Eligibility cache shared across check requests in this process.
const eligibilityCache = new EligibilityCache();

// POST /api/deals/check
// Full deal trace WITHOUT creating anything: given a candidate deal
// (asin + buyPrice from a retailer), the server fetches the LIVE Amazon sell
// price (SP-API Product Pricing), re-checks LIVE eligibility, runs the engine
// verdict, and evaluates the purchase guardrails. Returns the complete trace
// so the founder can see exactly what would happen before creating an intent
// via POST /api/purchases.
//
// Body: { asin, buyPrice, qty?, category? }
//   - asin: 10-char ASIN
//   - buyPrice: observed retailer price per unit (the "cheap source" side)
//   - qty: proposed units (default 10)
//   - category: optional, improves fee estimates
//
// Every external input is labeled with its source and confidence. A null
// live sell price or UNKNOWN eligibility is reported honestly — never
// papered over.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const asin = String(body.asin ?? "").trim().toUpperCase();
  const buyPrice = Number(body.buyPrice);
  const qty = body.qty === undefined ? 10 : Number(body.qty);
  const category =
    body.category === undefined || body.category === null
      ? undefined
      : String(body.category);

  const problems: string[] = [];
  if (!/^[A-Z0-9]{10}$/.test(asin)) problems.push("Valid 10-character asin required.");
  if (!(buyPrice > 0) || !Number.isFinite(buyPrice))
    problems.push("buyPrice must be a positive number (observed retailer price).");
  if (!(qty > 0) || !Number.isFinite(qty)) problems.push("qty must be a positive number.");
  if (problems.length > 0) {
    return NextResponse.json({ error: "Invalid input", reasons: problems }, { status: 400 });
  }

  const spCfg = spApiConfigFromEnv(process.env);

  // Live sell price and live eligibility run in parallel — both are honest
  // about failure.
  const [sellPrice, eligibility] = await Promise.all([
    spCfg
      ? getLiveSellPrice(spCfg, asin)
      : Promise.resolve({
          price: null as number | null,
          currency: "USD",
          reason: "SP-API not configured — live sell price unavailable.",
          checkedAt: new Date().toISOString(),
          source: "error" as const,
        }),
    checkEligibility(spCfg, asin, eligibilityCache),
  ]);

  // Engine verdict needs a sell price; without one the verdict is UNKNOWN.
  const evaluation =
    sellPrice.price !== null
      ? evaluateDeal(
          { buyPrice, sellPrice: sellPrice.price, category },
          { qty }
        )
      : {
          verdict: "UNKNOWN" as const,
          reasons: [`No live sell price (${sellPrice.reason}) — cannot evaluate.`],
          floorPrice: 0,
          realisticPrice: 0,
          netProfitAtRealistic: 0,
          marginAtRealistic: 0,
          estMonthlySales: 0,
          velocityBasis: "none",
          velocityConfidence: "unknown",
          daysToClear: null,
          suggestedQty: 0,
        };

  // Guard evaluation (dry run — nothing is created or persisted).
  const caps = capsFromEnv(process.env);
  const killSwitchOn = killSwitchFromEnv(process.env);
  const useSupabase = supabaseIsConfigured(process.env);
  const since = startOfUtcDay(new Date());
  let usage: SpendUsage;
  try {
    const admin = useSupabase ? getSupabaseAdmin() : null;
    if (admin) {
      const { data, error } = await admin
        .from("purchases")
        .select("qty, unit_price, asin, status")
        .gte("created_at", since.toISOString())
        .neq("status", "REJECTED");
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        qty: number;
        unit_price: number | string;
        asin: string;
        status: string;
      }>;
      usage = {
        spentToday: rows.reduce((s, r) => s + Number(r.qty) * Number(r.unit_price), 0),
        unitsForAsinToday: rows
          .filter((r) => r.asin === asin)
          .reduce((s, r) => s + Number(r.qty), 0),
      };
    } else {
      usage = sharedMemoryStore.usageFor(asin, since);
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not tally committed spend",
        reasons: [e instanceof Error ? e.message : "unknown error"],
      },
      { status: 503 }
    );
  }

  const guardDecision = canCreateIntent({
    verdict: evaluation.verdict,
    eligibility: eligibility.state,
    asin,
    qty,
    unitPrice: buyPrice,
    caps,
    usage,
    killSwitchOn,
    recheckDone: true,
  });

  return NextResponse.json({
    asin,
    qty,
    inputs: {
      buyPrice: { value: buyPrice, source: "founder-supplied", note: "Observed retailer price you provided." },
      sellPrice: {
        value: sellPrice.price,
        source: sellPrice.source,
        reason: sellPrice.reason,
        checkedAt: sellPrice.checkedAt,
      },
    },
    eligibility: {
      state: eligibility.state,
      reasons: eligibility.reasons,
      source: eligibility.source,
      checkedAt: eligibility.checkedAt,
    },
    verdict: {
      state: evaluation.verdict,
      reasons: evaluation.reasons,
      floorPrice: evaluation.floorPrice,
      realisticPrice: evaluation.realisticPrice,
      netProfitAtRealistic: evaluation.netProfitAtRealistic,
      marginAtRealistic: evaluation.marginAtRealistic,
      estMonthlySales: evaluation.estMonthlySales,
      velocityConfidence: evaluation.velocityConfidence,
      daysToClear: evaluation.daysToClear,
      suggestedQty: evaluation.suggestedQty,
    },
    guards: {
      wouldCreateIntent: guardDecision.allowed,
      reasons: guardDecision.reasons,
      caps: {
        dailySpendCap: caps.dailySpendCap,
        perOrderCap: caps.perOrderCap,
        maxUnitsPerAsin: caps.maxUnitsPerAsin,
      },
      usage,
      killSwitchOn,
    },
    nextStep:
      guardDecision.allowed && evaluation.verdict === "BUY"
        ? "Verdict is BUY and guards pass. Create the purchase intent with POST /api/purchases { asin, qty, unitPrice: buyPrice, sellPrice } — it will sit in PENDING_APPROVAL for your approval."
        : "No intent would be created. See guards.reasons and verdict.reasons above.",
  });
}
