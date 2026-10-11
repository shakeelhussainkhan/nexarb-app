// Shared watchlist-scan core.
// Extracted from POST /api/scan/trigger. Runs every active watchlist item
// through the full deal-check pipeline (live sell price + live eligibility +
// engine verdict + guard dry-run) and persists each trace to deal_checks.
// Never throws per-item: a failing item records an UNKNOWN row and the scan
// continues. Throws only for configuration/input failures (Supabase missing,
// watchlist unreadable) — callers translate those to their response shape.

import { runDealCheck, persistDealCheck, type DealCheckTrace } from "@/lib/engine/dealcheck";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { suggestListPrice, recordPriceMonitor } from "@/lib/engine/repricing";

export interface ScanResultItem {
  asin: string;
  verdict: string;
  eligibility: string;
  sellPrice: number | null;
  wouldCreateIntent: boolean;
}

export interface WatchlistScanResult {
  checked: number;
  buys: number;
  results: ScanResultItem[];
  /** Traces that verdict BUY — callers use these for alerts/notifications. */
  buyTraces: DealCheckTrace[];
}

const DEFAULT_LIMIT = 25;
const DEFAULT_QTY = 10;

export async function runWatchlistScan(
  opts: { limit?: number; userId?: string } = {}
): Promise<WatchlistScanResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  if (!supabaseIsConfigured(process.env)) {
    throw new Error("Supabase is not configured — nowhere to store scan results.");
  }

  const admin = getSupabaseAdmin();
  const { data: items, error } = await admin
    .from("watchlist")
    .select("asin, buy_price, category, buy_source")
    .eq("active", true)
    .order("added_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Could not read watchlist: ${error.message}`);
  }

  const list = (items ?? []) as Array<{
    asin: string;
    buy_price: number | string;
    category: string | null;
    buy_source: string | null;
  }>;

  const results: ScanResultItem[] = [];
  const buyTraces: DealCheckTrace[] = [];

  for (const item of list) {
    try {
      const trace = await runDealCheck(
        item.asin,
        Number(item.buy_price),
        DEFAULT_QTY,
        item.category ?? undefined,
        item.buy_source ?? undefined
      );
      await persistDealCheck(trace, opts.userId ?? null);
      // Price monitoring (WS4): record the suggested list price vs the
      // observed buy box after every check. Observability only — the
      // auto-reprice stub always skips, so nothing changes a live listing.
      const pricing = suggestListPrice({
        buyBoxPrice: trace.verdict.realisticPrice || null,
        floorPrice: trace.verdict.floorPrice,
        channel: trace.verdict.chosenChannel ?? "amazon-fba",
      });
      await recordPriceMonitor(admin, {
        asin: trace.asin,
        channel: trace.verdict.chosenChannel ?? "amazon-fba",
        ourPrice: pricing.suggested,
        buyBoxPrice: trace.verdict.realisticPrice || null,
      });
      results.push({
        asin: trace.asin,
        verdict: trace.verdict.state,
        eligibility: trace.eligibility.state,
        sellPrice: trace.inputs.sellPrice.value,
        wouldCreateIntent: trace.guards.wouldCreateIntent,
      });
      if (trace.verdict.state === "BUY") buyTraces.push(trace);
    } catch {
      results.push({
        asin: item.asin,
        verdict: "UNKNOWN",
        eligibility: "UNKNOWN",
        sellPrice: null,
        wouldCreateIntent: false,
      });
    }
  }

  const buys = results.filter((r) => r.verdict === "BUY").length;
  return { checked: results.length, buys, results, buyTraces };
}
