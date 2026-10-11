// Shared first-party deal-check pipeline.
// Used by POST /api/deals/check (single deal) and POST /api/scan/trigger
// (whole watchlist). Runs: live sell price + live eligibility (parallel) →
// engine verdict → guard dry-run. Never creates intents, never throws for
// expected data failures — every external input is labeled with its source.

import { evaluateDeal } from "@/lib/engine/verdict";
import {
  checkEligibility,
  spApiConfigFromEnv,
  EligibilityCache,
  type SpApiConfig,
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

const eligibilityCache = new EligibilityCache();

export interface DealCheckTrace {
  asin: string;
  qty: number;
  inputs: {
    buyPrice: { value: number; source: string; note: string };
    sellPrice: { value: number | null; source: string; reason: string; checkedAt: string };
  };
  eligibility: { state: string; reasons: string[]; source: string; checkedAt: string };
  verdict: {
    state: "BUY" | "SKIP" | "UNKNOWN";
    reasons: string[];
    floorPrice: number;
    realisticPrice: number;
    netProfitAtRealistic: number;
    marginAtRealistic: number;
    estMonthlySales: number;
    velocityConfidence: string;
    daysToClear: number | null;
    suggestedQty: number;
  };
  guards: {
    wouldCreateIntent: boolean;
    reasons: string[];
    caps: { dailySpendCap: number; perOrderCap: number; maxUnitsPerAsin: number };
    usage: SpendUsage;
    killSwitchOn: boolean;
  };
}

async function spendUsage(
  asin: string,
  since: Date,
  useSupabase: boolean
): Promise<SpendUsage> {
  if (useSupabase) {
    const admin = getSupabaseAdmin();
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
    return {
      spentToday: rows.reduce((s, r) => s + Number(r.qty) * Number(r.unit_price), 0),
      unitsForAsinToday: rows
        .filter((r) => r.asin === asin)
        .reduce((s, r) => s + Number(r.qty), 0),
    };
  }
  return sharedMemoryStore.usageFor(asin, since);
}

export async function runDealCheck(
  asin: string,
  buyPrice: number,
  qty = 10,
  category?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<DealCheckTrace> {
  const spCfg: SpApiConfig | null = spApiConfigFromEnv(env);

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

  const evaluation =
    sellPrice.price !== null
      ? evaluateDeal({ buyPrice, sellPrice: sellPrice.price, category }, { qty })
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

  const caps = capsFromEnv(env);
  const killSwitchOn = killSwitchFromEnv(env);
  const useSupabase = supabaseIsConfigured(env);
  const usage = await spendUsage(asin, startOfUtcDay(new Date()), useSupabase);

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

  return {
    asin,
    qty,
    inputs: {
      buyPrice: {
        value: buyPrice,
        source: "founder-supplied",
        note: "Observed retailer price provided.",
      },
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
  };
}

/** Persist a trace to deal_checks. Best-effort: never throws. */
export async function persistDealCheck(
  trace: DealCheckTrace,
  checkedBy: string | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  try {
    if (!supabaseIsConfigured(env)) return;
    const admin = getSupabaseAdmin();
    await admin.from("deal_checks").insert({
      asin: trace.asin,
      qty: trace.qty,
      buy_price: trace.inputs.buyPrice.value,
      buy_source: trace.inputs.buyPrice.source,
      sell_price: trace.inputs.sellPrice.value,
      sell_price_source: trace.inputs.sellPrice.source,
      eligibility: trace.eligibility.state,
      verdict: trace.verdict.state,
      verdict_reasons: trace.verdict.reasons,
      floor_price: trace.verdict.floorPrice,
      net_profit: trace.verdict.netProfitAtRealistic,
      margin_pct: trace.verdict.marginAtRealistic,
      would_create_intent: trace.guards.wouldCreateIntent,
      guard_reasons: trace.guards.reasons,
      checked_by: checkedBy,
    });
  } catch {
    // Persistence is observability, not correctness — never break the check.
  }
}
