// Extension analysis math — pure functions over live engine data.
//
// Two modes:
//   scout: the founder is browsing an Amazon product page with no buy price
//     yet. We answer "at what buy price would this be profitable?" — the
//     maximum buy price that still clears the target margin at the live
//     sell price.
//   full: the founder supplied a buy price; the engine verdict applies.
//
// All fee figures are the same ESTIMATES the dashboard engine uses
// (lib/engine/pricing.ts). Callers must surface that.

import {
  estimateFbaFee,
  referralPctForCategory,
} from "@/lib/engine/pricing.ts";

// Must stay in sync with landedCosts() in lib/engine/pricing.ts.
const PREP_PER_UNIT = 1.25;
const INBOUND_PER_UNIT = 0.45;
const STORAGE_PER_UNIT = 0.35;

export const EXTENSION_TARGET_MARGIN_PCT = 0.2;

/**
 * Maximum buy price (per unit, all-in before buy) that still achieves the
 * target margin at `sellPrice`. Inverse of floorPrice():
 *   maxBuy = sell*(1 - referral - margin) - prep - inbound - fba - storage
 * Returns null when the inputs are unusable.
 */
export function maxProfitableBuyPrice(
  sellPrice: number,
  category?: string,
  targetMarginPct = EXTENSION_TARGET_MARGIN_PCT
): number | null {
  if (!(sellPrice > 0) || !Number.isFinite(sellPrice)) return null;
  if (!(targetMarginPct >= 0) || targetMarginPct >= 1) return null;
  const referral = referralPctForCategory(category);
  const fba = estimateFbaFee(sellPrice);
  const maxBuy =
    sellPrice * (1 - referral - targetMarginPct) -
    PREP_PER_UNIT -
    INBOUND_PER_UNIT -
    fba -
    STORAGE_PER_UNIT;
  if (!Number.isFinite(maxBuy)) return null;
  return Math.round(maxBuy * 100) / 100;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Profit/margin outcome at a candidate buy price — mirrors outcomeAtPrice()
 * so the popup and the engine can never disagree on the arithmetic.
 */
export function outcomeForBuyPrice(
  sellPrice: number,
  buyPrice: number,
  category?: string
): { netProfit: number; marginPct: number; roiPct: number } | null {
  if (!(sellPrice > 0) || !(buyPrice > 0)) return null;
  if (!Number.isFinite(sellPrice) || !Number.isFinite(buyPrice)) return null;
  const referral = referralPctForCategory(category);
  const fba = estimateFbaFee(sellPrice);
  const netProfit =
    sellPrice - referral * sellPrice - buyPrice - PREP_PER_UNIT - INBOUND_PER_UNIT - fba - STORAGE_PER_UNIT;
  const landed = buyPrice + PREP_PER_UNIT + INBOUND_PER_UNIT;
  return {
    netProfit: round2(netProfit),
    marginPct: round2(netProfit / sellPrice),
    roiPct: landed > 0 ? round2(netProfit / landed) : 0,
  };
}

/**
 * Extract a 10-char ASIN from an Amazon product URL. Handles /dp/, /gp/product/,
 * /gp/aw/d/, and bare ASIN path segments. Returns null when none found.
 */
export function asinFromUrl(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /[?&]asin=([A-Z0-9]{10})(?:[&#]|$)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** True for Amazon storefront hosts (any marketplace). */
export function isAmazonHost(host: string): boolean {
  if (!host || typeof host !== "string") return false;
  const h = host.toLowerCase();
  return h === "amazon.com" || h.endsWith(".amazon.com") || /^amazon\.[a-z.]+$/.test(h);
}
