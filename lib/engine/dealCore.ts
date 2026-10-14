// Shared deal mapping: one deal_checks row -> the dashboard's Deal shape.
//
// Extracted from GET /api/deals so the list route and the per-ASIN detail
// route (GET /api/deals/[asin]) compute a deal identically instead of
// drifting apart. Pure: no DB, no network. Velocity and catalog display
// info are layered on by callers (they need batched reads); the values
// here are the honest placeholders the list route used before enrichment
// ("insufficient data" velocity, bare-ASIN title).

import { assessTrust } from "@/lib/engine/trust";

export interface DealEngine {
  verdict: "BUY" | "SKIP" | "UNKNOWN";
  reasons: string[];
  floorPrice: number;
  realisticPrice: number;
  netProfitAtRealistic: number;
  marginAtRealistic: number;
  estMonthlySales: number;
  velocityBasis: string;
  velocityConfidence: string;
  daysToClear: number | null;
  suggestedQty: number;
  // First-party BSR → units/day velocity (lib/engine/velocity.ts). Populated
  // per ASIN from the velocity_snapshots series after the deal loop; nulls
  // here mean "insufficient data", never a fabricated figure.
  velocity: {
    unitsPerDay: number | null;
    confidence: "low" | "medium" | "high" | "unknown";
    trend: "improving" | "declining" | "stable" | "insufficient";
    snapshotCount: number;
    spanDays: number;
    basis: string;
  };
  // Multi-channel breakdown. deal_checks stores only the chosen/lead
  // channel's numbers (no channels column — migrations out of scope), so
  // this is the honest minimum reconstructed from the row: the priced
  // channel carries the row's numbers; the Walmart channel is unavailable
  // until a real competitive-pricing endpoint exists (lib/walmart/pricing.ts).
  channels: DealChannel[];
  chosenChannel: "amazon-fba" | "walmart-wfs" | null;
}

export interface DealChannel {
  channel: "amazon-fba" | "walmart-wfs";
  sellPrice: number | null;
  sellPriceSource: string;
  netProfit: number;
  marginPct: number;
  verdict: "BUY" | "SKIP" | "UNKNOWN";
}

export interface Deal {
  id: number;
  asin: string;
  title: string;
  /** Catalog display facts (migration 017, from the watchlist row). */
  brand: string | null;
  imageUrl: string | null;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  margin: number;
  bsr: number;
  channel: string;
  confidence: string;
  verifiedPrice: boolean;
  category: string;
  timestamp: string;
  trust: { level: "verified-retailer" | "unverified"; notes: string[] };
  engine: DealEngine;
}

/** Raw deal_checks row as selected by the deals routes. */
export interface DealCheckRow {
  id: number;
  asin: string;
  qty: number;
  buy_price: number | string;
  buy_source: string;
  sell_price: number | string | null;
  sell_price_source: string;
  eligibility: string;
  verdict: string;
  verdict_reasons: string[] | null;
  floor_price: number | string | null;
  net_profit: number | string | null;
  margin_pct: number | string | null;
  checked_at: string;
}

/**
 * Map one deal_checks row to a Deal. Identical to the mapping the deals
 * list has always done inline: the priced channel (sp-api-pricing, or a
 * walmart-sourced price) carries the row's numbers, the other channel is
 * UNKNOWN/unavailable, and chosenChannel is set only for BUY rows.
 */
export function dealFromCheckRow(row: DealCheckRow): Deal {
  const sellPrice = row.sell_price === null ? 0 : Number(row.sell_price);
  const netProfit = row.net_profit === null ? 0 : Number(row.net_profit);
  const margin = row.margin_pct === null ? 0 : Number(row.margin_pct);
  const floorPrice = row.floor_price === null ? 0 : Number(row.floor_price);
  const verdict =
    row.verdict === "BUY" || row.verdict === "SKIP" ? row.verdict : "UNKNOWN";
  // Reconstruct the per-channel breakdown from the chosen-channel row.
  // Only "sp-api-pricing" rows carry a real priced channel today; anything
  // else means no channel had price data. chosenChannel is set only for
  // BUY rows (pre-channels rows were all Amazon).
  const amazonPriced = row.sell_price_source === "sp-api-pricing";
  const walmartPriced =
    !amazonPriced && row.sell_price_source.startsWith("walmart");
  const amazonChannel: DealChannel = amazonPriced
    ? {
        channel: "amazon-fba",
        sellPrice,
        sellPriceSource: row.sell_price_source,
        netProfit,
        marginPct: margin,
        // Aggregate verdict == channel verdict when a single channel
        // carried price data (velocity-UNKNOWN folds into aggregate SKIP).
        verdict,
      }
    : {
        channel: "amazon-fba",
        sellPrice: null,
        sellPriceSource: row.sell_price_source,
        netProfit: 0,
        marginPct: 0,
        verdict: "UNKNOWN",
      };
  const walmartChannel: DealChannel = walmartPriced
    ? {
        channel: "walmart-wfs",
        sellPrice,
        sellPriceSource: row.sell_price_source,
        netProfit,
        marginPct: margin,
        verdict,
      }
    : {
        channel: "walmart-wfs",
        sellPrice: null,
        // The seller API exposes no competitive pricing (lib/walmart/pricing.ts).
        sellPriceSource: "unavailable",
        netProfit: 0,
        marginPct: 0,
        verdict: "UNKNOWN",
      };
  let chosenChannel: DealEngine["chosenChannel"] = null;
  if (verdict === "BUY") {
    if (amazonPriced) chosenChannel = "amazon-fba";
    else if (walmartPriced) chosenChannel = "walmart-wfs";
  }
  return {
    id: row.id,
    asin: row.asin,
    title: row.asin,
    brand: null,
    imageUrl: null,
    buyPrice: Number(row.buy_price),
    sellPrice,
    profit: netProfit,
    margin,
    bsr: 0,
    channel: row.buy_source.includes("walmart") ? "Walmart" : "Manual",
    trust: assessTrust(row.buy_source),
    confidence:
      row.sell_price_source === "sp-api-pricing" && row.eligibility !== "UNKNOWN"
        ? "High"
        : "Low",
    verifiedPrice: row.sell_price_source === "sp-api-pricing",
    category: row.eligibility,
    timestamp: row.checked_at,
    engine: {
      verdict: verdict as "BUY" | "SKIP" | "UNKNOWN",
      reasons: row.verdict_reasons ?? [],
      floorPrice,
      realisticPrice: sellPrice,
      netProfitAtRealistic: netProfit,
      marginAtRealistic: margin,
      estMonthlySales: 0,
      velocityBasis: "unavailable",
      velocityConfidence: "low",
      daysToClear: null,
      suggestedQty: row.qty ?? 10,
      velocity: {
        unitsPerDay: null,
        confidence: "unknown",
        trend: "insufficient",
        snapshotCount: 0,
        spanDays: 0,
        basis: "insufficient data",
      },
      channels: [amazonChannel, walmartChannel],
      chosenChannel,
    },
  };
}
