// First-party price-history stats — our Keepa-chart replacement, pure logic.
//
// Every scan persists sell_price per ASIN into deal_checks. This module turns
// those points into the summary behind the price-history chart: min/max/avg,
// the median band, and the dealQuality label that answers Keepa's core
// question — "is this price actually a dip, or is it always this price?"
//
// Pure (no network, no secrets) so it can be unit-tested offline.

export interface PricePoint {
  checkedAt: string; // ISO timestamp
  sellPrice: number; // must be finite and > 0 to count
  buyPrice: number;
  verdict: string;
}

export type DealQuality = "genuine dip" | "typical" | "elevated" | "insufficient data";

export interface PriceHistorySummary {
  count: number; // priced points used
  minSell: number | null;
  maxSell: number | null;
  avgSell: number | null;
  medianSell: number | null;
  currentSell: number | null; // most recent priced point
  deltaVsMedianPct: number | null; // (current - median) / median * 100
  dealQuality: DealQuality;
}

// A current price at least this far below the window median counts as a
// "genuine dip"; at least this far above counts as "elevated".
export const DIP_THRESHOLD_PCT = 10;

// Minimum priced points before we'll label anything (fewer = noise).
export const MIN_POINTS = 3;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const EMPTY: PriceHistorySummary = {
  count: 0,
  minSell: null,
  maxSell: null,
  avgSell: null,
  medianSell: null,
  currentSell: null,
  deltaVsMedianPct: null,
  dealQuality: "insufficient data",
};

export function summarizePriceHistory(points: PricePoint[]): PriceHistorySummary {
  const priced = points
    .filter((p) => Number.isFinite(p.sellPrice) && p.sellPrice > 0)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
  if (priced.length < MIN_POINTS) return { ...EMPTY, count: priced.length };

  const sells = priced.map((p) => p.sellPrice);
  const median = medianOf(sells);
  if (!(median > 0)) return { ...EMPTY, count: priced.length };

  const current = sells[sells.length - 1];
  const delta = ((current - median) / median) * 100;
  const dealQuality: DealQuality =
    delta <= -DIP_THRESHOLD_PCT
      ? "genuine dip"
      : delta >= DIP_THRESHOLD_PCT
        ? "elevated"
        : "typical";

  return {
    count: priced.length,
    minSell: Math.min(...sells),
    maxSell: Math.max(...sells),
    avgSell: sells.reduce((a, b) => a + b, 0) / sells.length,
    medianSell: median,
    currentSell: current,
    deltaVsMedianPct: delta,
    dealQuality,
  };
}
