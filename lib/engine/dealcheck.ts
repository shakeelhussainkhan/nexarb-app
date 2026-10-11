// Shared first-party deal-check pipeline.
// Used by POST /api/deals/check (single deal) and POST /api/scan/trigger
// (whole watchlist). Runs: live sell prices (Amazon + Walmart, parallel) +
// live eligibility → per-channel engine verdicts → guard dry-run. Never
// creates intents, never throws for expected data failures — every external
// input is labeled with its source.

import {
  evaluateChannels,
  type ChannelEvaluation,
  type SalesChannel,
} from "@/lib/engine/verdict";
import {
  checkEligibility,
  spApiConfigFromEnv,
  EligibilityCache,
  type SpApiConfig,
} from "@/lib/engine/eligibility";
import { getLiveSellPrice } from "@/lib/spapi/pricing";
import { getWalmartSellPrice } from "@/lib/walmart/pricing";
import { walmartConfigFromEnv } from "@/lib/walmart/client";
import {
  fetchSalesRankSnapshot,
  recordVelocitySnapshot,
  getVelocitySignals,
} from "@/lib/engine/velocity";
import { assessTrust } from "@/lib/engine/trust";
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
    // Multi-channel breakdown. Headline fields above always describe the
    // lead channel (the chosen one when BUY-eligible) for backward
    // compatibility; the full per-channel picture lives here.
    channels: ChannelEvaluation[];
    chosenChannel: SalesChannel | null;
  };
  guards: {
    wouldCreateIntent: boolean;
    reasons: string[];
    caps: { dailySpendCap: number; perOrderCap: number; maxUnitsPerAsin: number };
    usage: SpendUsage;
    killSwitchOn: boolean;
  };
  trust: { level: "verified-retailer" | "unverified"; notes: string[] };
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
  buySource?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<DealCheckTrace> {
  const spCfg: SpApiConfig | null = spApiConfigFromEnv(env);
  const walmartCfg = walmartConfigFromEnv(env);
  const useSupabase = supabaseIsConfigured(env);

  const [sellPrice, walmartPrice, eligibility] = await Promise.all([
    spCfg
      ? getLiveSellPrice(spCfg, asin)
      : Promise.resolve({
          price: null as number | null,
          currency: "USD",
          reason: "SP-API not configured — live sell price unavailable.",
          checkedAt: new Date().toISOString(),
          source: "error" as const,
        }),
    // Walmart competitive pricing is unavailable (see lib/walmart/pricing.ts
    // for the investigation). The lookup never throws by contract; guard it
    // anyway so a future implementation can never break the check.
    getWalmartSellPrice(asin, walmartCfg).catch(
      (): { price: number | null; source: string; reason: string } => ({
        price: null,
        source: "error",
        reason: "Walmart sell-price lookup failed unexpectedly — treated as unknown.",
      })
    ),
    checkEligibility(spCfg, asin, eligibilityCache),
  ]);

  // First-party velocity (WS3): capture this check's sales rank, persist the
  // snapshot, then read the series back. All helpers never throw; a thin
  // series yields honest low-confidence signals.
  const { rank, category: rankCategory } = spCfg
    ? await fetchSalesRankSnapshot(spCfg, asin)
    : { rank: null as number | null, category: null as string | null };
  if (useSupabase) {
    await recordVelocitySnapshot(getSupabaseAdmin(), asin, rank, rankCategory);
  }
  const velocitySignals = useSupabase
    ? await getVelocitySignals(getSupabaseAdmin(), asin)
    : {};

  const evaluation = evaluateChannels({
    buyPrice,
    category,
    amazon: {
      sellPrice: sellPrice.price,
      source: sellPrice.source,
      reason: sellPrice.price === null ? sellPrice.reason : undefined,
    },
    walmart: {
      sellPrice: walmartPrice.price,
      source: walmartPrice.source,
      reason: walmartPrice.reason,
    },
    velocitySignals,
    qty,
  });

  const caps = capsFromEnv(env);
  const killSwitchOn = killSwitchFromEnv(env);
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

  // Backward compatible: the single-channel inputs/verdict fields now
  // describe the CHOSEN channel. When nothing is chosen (SKIP/UNKNOWN),
  // fall back to the Amazon inputs so the legacy shape is preserved.
  const walmartCheckedAt = new Date().toISOString();
  const chosenSellPriceInput =
    evaluation.chosenChannel === "walmart-wfs"
      ? {
          value: walmartPrice.price,
          source: walmartPrice.source,
          reason: walmartPrice.reason,
          checkedAt: walmartCheckedAt,
        }
      : {
          value: sellPrice.price,
          source: sellPrice.source,
          reason: sellPrice.reason,
          checkedAt: sellPrice.checkedAt,
        };

  return {
    asin,
    qty,
    inputs: {
      buyPrice: {
        value: buyPrice,
        source: buySource ?? "founder-supplied",
        note: "Observed retailer price provided.",
      },
      sellPrice: chosenSellPriceInput,
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
      channels: evaluation.channels,
      chosenChannel: evaluation.chosenChannel,
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
    trust: assessTrust(buySource ?? "founder-supplied"),
  };
}

/** Persist a trace to deal_checks. Best-effort: never throws.
 * NOTE: the per-channel breakdown (verdict.channels) is not persisted —
 * deal_checks has no channels column and migrations are out of scope. The
 * stored sell_price/floor_price/net_profit/margin_pct are the chosen/lead
 * channel's numbers; GET /api/deals reconstructs the honest minimum from
 * them (see app/api/deals/route.ts). */
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
