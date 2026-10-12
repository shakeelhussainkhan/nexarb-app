// Listings sync + reprice pure logic — offline-testable, no network, no DB.
//
// Covered by scripts/verify-listings.mjs.

const round2 = (n: number): number => Math.round(n * 100) / 100;

// --- bound validation -------------------------------------------------------

export interface BoundCheck {
  ok: boolean;
  reason: string; // empty on success
}

// Validate a manual reprice against founder-approved watchlist bounds.
// Bounds are optional: a null bound is not enforced. Returns the real
// reason on violation so the API route can surface it verbatim (422).
export function validateRepriceBounds(
  price: number,
  priceMin: number | null,
  priceMax: number | null
): BoundCheck {
  if (!(typeof price === "number") || !(price > 0)) {
    return { ok: false, reason: "Price must be a positive number." };
  }
  const rounded = round2(price);
  if (rounded <= 0) return { ok: false, reason: "Price must be a positive number." };
  if (priceMin != null && priceMin > 0 && rounded < priceMin) {
    return {
      ok: false,
      reason: `Refused: $${rounded.toFixed(2)} is below your approved floor of $${priceMin.toFixed(2)} for this product.`,
    };
  }
  if (priceMax != null && priceMax > 0 && rounded > priceMax) {
    return {
      ok: false,
      reason: `Refused: $${rounded.toFixed(2)} is above your approved ceiling of $${priceMax.toFixed(2)} for this product.`,
    };
  }
  return { ok: true, reason: "" };
}

// --- sync upsert dedup -------------------------------------------------------

export interface SyncedListingRow {
  channel: "amazon" | "walmart";
  sellerSku: string;
  asin: string | null; // null when the channel gives no ASIN mapping (Walmart SKUs)
  title: string | null;
  ourPrice: number | null;
  buyboxPrice: number | null;
  buyboxWinner: boolean | null;
  offerCount: number | null;
}

// Dedup a sync batch by (channel, seller_sku): later rows win. The sync
// route may produce multiple rows for one SKU (e.g. listing read + offers
// snapshot); this keeps exactly one per SKU for the upsert.
export function dedupForUpsert(rows: SyncedListingRow[]): SyncedListingRow[] {
  const seen = new Map<string, SyncedListingRow>();
  for (const row of rows) {
    seen.set(`${row.channel}|${row.sellerSku}`, row);
  }
  return [...seen.values()];
}

// --- win/lose derivation -----------------------------------------------------

export type BuyBoxState = "winning" | "losing" | "unknown";

export function deriveBuyBoxState(buyboxWinner: boolean | null): BuyBoxState {
  if (buyboxWinner === true) return "winning";
  if (buyboxWinner === false) return "losing";
  return "unknown";
}

// --- margin at current price -------------------------------------------------

export interface MarginAtPrice {
  netProfit: number | null; // per unit, null when inputs incomplete
  marginPct: number | null; // netProfit / price, null when incomplete
}

// Margin at the live list price: sell price minus buy cost minus fees.
// All inputs must be positive numbers; anything else yields nulls rather
// than a fabricated margin.
export function marginAtPrice(
  sellPrice: number | null,
  buyCostPerUnit: number | null,
  feesPerUnit: number | null
): MarginAtPrice {
  if (
    !(typeof sellPrice === "number") ||
    !(sellPrice > 0) ||
    !(typeof buyCostPerUnit === "number") ||
    !(buyCostPerUnit >= 0) ||
    !(typeof feesPerUnit === "number") ||
    !(feesPerUnit >= 0)
  ) {
    return { netProfit: null, marginPct: null };
  }
  const netProfit = round2(sellPrice - buyCostPerUnit - feesPerUnit);
  return { netProfit, marginPct: round2(netProfit / sellPrice) };
}
