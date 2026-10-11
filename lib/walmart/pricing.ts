// Walmart sell-price lookup + WFS fee stack.
//
// SELL-PRICE INVESTIGATION (2026-10-11) — what can the existing Walmart
// seller API credentials return for competitive marketplace pricing?
//
// The Walmart Marketplace (seller) API — the API the credentials in
// lib/walmart/client.ts authenticate against — exposes, per
// developer.walmart.com:
//   Items API     — manage YOUR OWN catalog items
//   Prices API    — GET /v3/price?sku=... returns YOUR OWN price for a SKU
//                   you already list (and lets you update it)
//   Inventory / Orders / Feeds / Reports / Repricer — your own account data
//
// What it does NOT expose: any SP-API-style competitive-pricing endpoint
// that returns the live marketplace (Buy Box / landed) price for an
// arbitrary UPC or ASIN. The Prices API only answers for SKUs you already
// sell. Competitive UPC-lookup pricing for Walmart exists only via paid
// third-party data vendors / scraping APIs — out of scope for NexArb
// (official APIs only, no paid data, no scraping, never invent a price).
//
// Consequence: getWalmartSellPrice() resolves to { price: null, source:
// "unavailable" } with an honest reason. It makes no network call because
// there is no endpoint to call. If Walmart ever ships a competitive-pricing
// endpoint for sellers, wire it here behind the same never-throw contract.

import { referralPctForCategory } from "@/lib/engine/pricing.ts";
import type { WalmartConfig } from "@/lib/walmart/client.ts";

export interface WalmartSellPrice {
  price: number | null;
  source: string; // "unavailable" until a real competitive endpoint exists
  reason: string;
}

const UNAVAILABLE_REASON =
  "Walmart seller API does not expose marketplace competitive pricing — " +
  "no SP-API-style Buy Box endpoint exists; the Prices API only returns " +
  "your own SKU prices. No price invented; treat as unknown.";

export async function getWalmartSellPrice(
  upcOrAsin: string,
  cfg: WalmartConfig | null = null
): Promise<WalmartSellPrice> {
  // Both parameters are accepted for signature compatibility with a future
  // real endpoint; neither is used today because there is no endpoint to call.
  void upcOrAsin;
  void cfg;
  return { price: null, source: "unavailable", reason: UNAVAILABLE_REASON };
}

// --- WFS fee stack (transparent estimator) ---------------------------------

// WFS fulfillment fee: FLAT PER-UNIT ESTIMATE, in USD. Real WFS fulfillment
// fees are size/weight-tiered per unit shipped; without item dimensions this
// is a placeholder. Labeled ESTIMATE everywhere it surfaces — never present
// it as Walmart's published fee.
export const WFS_FULFILLMENT_FEE_ESTIMATE = 5.5;

export interface WfsFeeStack {
  referralPct: number; // fraction, e.g. 0.15
  referralFee: number; // USD at `price`
  fulfillmentFee: number; // USD — always WFS_FULFILLMENT_FEE_ESTIMATE (ESTIMATE)
  totalFees: number; // referralFee + fulfillmentFee
  assumptions: string[]; // every assumption, surfaced to callers
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function wfsFeeStack(
  price: number,
  category: string | undefined
): WfsFeeStack {
  // ASSUMPTIONS (also returned in `assumptions` so UIs can surface them):
  // 1. Referral % reuses NexArb's referralPctForCategory() map, which is
  //    calibrated on Amazon's fee table. Walmart publishes its own
  //    referral-fee table — typically ~15% for most categories but not
  //    identical per category. Treat as a proxy; override with Walmart's
  //    table when wired.
  // 2. WFS fulfillment is a flat $5.50/unit ESTIMATE (see
  //    WFS_FULFILLMENT_FEE_ESTIMATE). Real fees vary by size tier/weight.
  // 3. Covers referral + fulfillment ONLY. Inbound freight into WFS, prep,
  //    storage, and returns processing are NOT included — the channel
  //    comparison adds the shared landed-cost fields (prep/inbound/storage)
  //    on top, exactly as the Amazon channel does.
  const referralPct = referralPctForCategory(category);
  const referralFee = price * referralPct;
  const fulfillmentFee = WFS_FULFILLMENT_FEE_ESTIMATE;
  return {
    referralPct,
    referralFee: round2(referralFee),
    fulfillmentFee: round2(fulfillmentFee),
    totalFees: round2(referralFee + fulfillmentFee),
    assumptions: [
      `Referral ${(referralPct * 100).toFixed(0)}% reuses NexArb's Amazon-calibrated category map as a proxy — Walmart publishes its own referral-fee table.`,
      `WFS fulfillment $${fulfillmentFee.toFixed(2)}/unit is an ESTIMATE (flat placeholder); real WFS fees are size/weight-tiered.`,
      "Inbound freight to WFS, prep, storage, and returns are NOT included — added as shared landed costs in the channel comparison.",
    ],
  };
}
