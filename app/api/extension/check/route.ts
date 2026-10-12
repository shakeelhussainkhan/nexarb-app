import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashApiKey, isPlausibleApiKey } from "@/lib/extension/keys";
import { checkRateLimit, RATE_LIMIT_MAX } from "@/lib/extension/rateLimit";
import {
  maxProfitableBuyPrice,
  EXTENSION_TARGET_MARGIN_PCT,
} from "@/lib/extension/analysis";
import { getLiveSellPrice } from "@/lib/spapi/pricing";
import {
  checkEligibility,
  EligibilityCache,
  spApiConfigFromEnv,
} from "@/lib/engine/eligibility";
import {
  estimateVelocity,
  fetchSalesRankSnapshot,
  getVelocitySignals,
  recordVelocitySnapshot,
} from "@/lib/engine/velocity";
import { runDealCheck, persistDealCheck } from "@/lib/engine/dealcheck";
import { supabaseIsConfigured } from "@/lib/engine/guards";

// POST /api/extension/check — one-click deal analysis for the NexArb Chrome
// extension. Auth is a personal API key in the X-NexArb-Key header (NOT
// Clerk — the extension can't do the Clerk browser flow).
//
// Body: { asin: "B0XXXXXXX", buyPrice?: 12.34 }
//   - without buyPrice → "scout" mode: live sell price, eligibility,
//     velocity, and the max buy price that still clears the target margin.
//   - with buyPrice → "full" mode: the same deal-check engine the dashboard
//     uses, including the BUY/SKIP/UNKNOWN verdict.
//
// The extension NEVER sends Amazon session cookies or credentials — it only
// sends the ASIN read from the page URL. Rate limit: 60 req/min per key.

const eligibilityCache = new EligibilityCache();

interface KeyRow {
  id: string;
  user_id: string;
  revoked_at: string | null;
}

async function authenticate(req: NextRequest): Promise<KeyRow | null> {
  const presented = req.headers.get("x-nexarb-key");
  if (!isPlausibleApiKey(presented)) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("api_keys")
      .select("id, user_id, revoked_at")
      .eq("key_hash", hashApiKey(presented))
      .is("revoked_at", null)
      .single();
    if (error || !data) return null;
    return data as KeyRow;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const key = await authenticate(req);
    if (!key) {
      return NextResponse.json(
        { error: "Invalid or revoked API key. Create one in Settings → API keys." },
        { status: 401 }
      );
    }

    const rl = checkRateLimit(key.id);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded (${RATE_LIMIT_MAX}/min).`, retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const asin = String(body.asin ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: "Valid 10-character asin required." }, { status: 400 });
    }
    const buyPrice =
      body.buyPrice === undefined || body.buyPrice === null ? undefined : Number(body.buyPrice);
    if (buyPrice !== undefined && (!(buyPrice > 0) || !Number.isFinite(buyPrice))) {
      return NextResponse.json({ error: "buyPrice must be a positive number when provided." }, { status: 400 });
    }

    // Touch last_used_at — fire and forget.
    void getSupabaseAdmin()
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id)
      .then(
        () => undefined,
        () => undefined
      );

    const env = process.env;
    const spCfg = spApiConfigFromEnv(env);
    const useSupabase = supabaseIsConfigured(env);

    // Full mode: the founder supplied a buy price — run the real engine.
    if (buyPrice !== undefined) {
      const trace = await runDealCheck(asin, buyPrice, 10, undefined, "extension");
      if (useSupabase) {
        try {
          await persistDealCheck(trace, key.user_id);
        } catch {
          // A failed persist must not fail the analysis.
        }
      }
      return NextResponse.json({
        asin,
        mode: "full",
        verdict: trace.verdict.state,
        verdictReasons: trace.verdict.reasons,
        sellPrice: trace.inputs.sellPrice.value,
        sellPriceSource: trace.inputs.sellPrice.source,
        eligibility: { state: trace.eligibility.state, reasons: trace.eligibility.reasons },
        netProfit: trace.verdict.netProfitAtRealistic,
        marginPct: trace.verdict.marginAtRealistic,
        floorPrice: trace.verdict.floorPrice,
        realisticPrice: trace.verdict.realisticPrice,
        estMonthlySales: trace.verdict.estMonthlySales,
        velocityConfidence: trace.verdict.velocityConfidence,
        suggestedQty: trace.verdict.suggestedQty,
        feeEstimates: true,
        feeNote: "Fees are estimates until real per-ASIN fee data is wired in.",
      });
    }

    // Scout mode: no buy price yet — report the live picture plus the max
    // buy price that still clears the target margin.
    const [sellPrice, eligibility, rankSnap] = await Promise.all([
      spCfg
        ? getLiveSellPrice(spCfg, asin)
        : Promise.resolve({
            price: null as number | null,
            currency: "USD",
            reason: "SP-API not configured — live sell price unavailable.",
            checkedAt: new Date().toISOString(),
            source: "error" as const,
            belongsToRequester: null as boolean | null,
          }),
      checkEligibility(spCfg, asin, eligibilityCache),
      spCfg ? fetchSalesRankSnapshot(spCfg, asin) : Promise.resolve({ rank: null as number | null, category: null as string | null }),
    ]);

    if (useSupabase) {
      await recordVelocitySnapshot(getSupabaseAdmin(), asin, rankSnap.rank, rankSnap.category);
    }
    const velocitySignals = useSupabase
      ? await getVelocitySignals(getSupabaseAdmin(), asin)
      : { bsr: rankSnap.rank ?? undefined, category: rankSnap.category ?? undefined };
    const velocity = estimateVelocity(velocitySignals);

    const maxBuy =
      sellPrice.price !== null
        ? maxProfitableBuyPrice(sellPrice.price, rankSnap.category ?? undefined)
        : null;

    return NextResponse.json({
      asin,
      mode: "scout",
      sellPrice: sellPrice.price,
      sellPriceSource: sellPrice.source,
      sellPriceReason: sellPrice.price === null ? sellPrice.reason : undefined,
      eligibility: { state: eligibility.state, reasons: eligibility.reasons },
      velocity: {
        estMonthlySales: velocity.monthlySales,
        range: [velocity.low, velocity.high],
        confidence: velocity.confidence,
        basis: velocity.basis,
        bsr: rankSnap.rank,
        category: rankSnap.category,
      },
      scout: {
        maxBuyPrice: maxBuy,
        targetMarginPct: EXTENSION_TARGET_MARGIN_PCT,
        note:
          maxBuy === null
            ? "Could not compute — live sell price unavailable."
            : `Buy at or below this per unit to clear a ${Math.round(EXTENSION_TARGET_MARGIN_PCT * 100)}% margin at the live sell price (fee estimates).`,
      },
      feeEstimates: true,
      feeNote: "Fees are estimates until real per-ASIN fee data is wired in.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Extension check failed", reasons: [e instanceof Error ? e.message : "unknown"] },
      { status: 503 }
    );
  }
}
