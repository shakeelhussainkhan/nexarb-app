// Sales-velocity estimation and the "fast-selling only" gate.
//
// Signal reliability (from 2026-10-10 research): Amazon "bought in past month"
// is a floor, Keepa BSR drops are a floor, BSR-to-units models diverge ~19-30%
// between vendors. We therefore triangulate and always return a range with a
// confidence label. A model-only estimate is LOW confidence by design.

export interface VelocitySignals {
  bsr?: number; // current sales rank (snapshot)
  category?: string;
  boughtPastMonth?: number; // Amazon "bought in past month" lower bound (e.g. 100, 1000)
  bsrDrops30d?: number; // Keepa rank drops over 30 days (~ sale events, a floor)
  fbaOffers?: number; // comparable FBA offers competing for the Buy Box
  amazonOnListing?: boolean; // Amazon itself sells it (Buy Box share haircut)
}

export interface VelocityEstimate {
  monthlySales: number; // triangulated point estimate
  low: number;
  high: number;
  basis: "bought-in-past-month" | "bsr-drops" | "bsr-model" | "none";
  confidence: "high" | "medium" | "low" | "unknown";
}

// [bsr, units/month] anchor points per category (log-log interpolation).
// Calibrated so Beauty @ ~5,000 BSR lands ~2,200-2,600/mo (the two leading
// commercial estimators' published range for that rank).
const ANCHORS: Record<string, [number, number][]> = {
  electronics: [[100, 30000], [1000, 6000], [10000, 900], [50000, 220], [100000, 110], [500000, 18]],
  "home & kitchen": [[100, 20000], [1000, 4500], [10000, 800], [50000, 200], [100000, 95], [500000, 15]],
  kitchen: [[100, 20000], [1000, 4500], [10000, 800], [50000, 200], [100000, 95], [500000, 15]],
  toys: [[100, 15000], [1000, 3500], [10000, 650], [50000, 160], [100000, 80], [500000, 13]],
  "toys & games": [[100, 15000], [1000, 3500], [10000, 650], [50000, 160], [100000, 80], [500000, 13]],
  beauty: [[100, 25000], [1000, 5000], [5000, 2400], [10000, 1100], [50000, 260], [100000, 120], [500000, 22]],
  default: [[1000, 3000], [10000, 600], [50000, 150], [100000, 80], [500000, 12]],
};

function modelMonthlySales(bsr: number, category?: string): number {
  const table = ANCHORS[(category ?? "").trim().toLowerCase()] ?? ANCHORS.default;
  if (bsr <= table[0][0]) {
    const [b0, u0] = table[0];
    const [b1, u1] = table[1];
    const slope = Math.log(u1 / u0) / Math.log(b1 / b0);
    return u0 * Math.pow(bsr / b0, slope);
  }
  for (let i = 0; i < table.length - 1; i++) {
    const [b0, u0] = table[i];
    const [b1, u1] = table[i + 1];
    if (bsr >= b0 && bsr <= b1) {
      const t = (Math.log(bsr) - Math.log(b0)) / (Math.log(b1) - Math.log(b0));
      return Math.exp(Math.log(u0) + t * (Math.log(u1) - Math.log(u0)));
    }
  }
  const [b0, u0] = table[table.length - 2];
  const [b1, u1] = table[table.length - 1];
  const slope = Math.log(u1 / u0) / Math.log(b1 / b0);
  return Math.max(1, u1 * Math.pow(bsr / b1, slope));
}

export function estimateVelocity(s: VelocitySignals): VelocityEstimate {
  const floors: { value: number; basis: VelocityEstimate["basis"] }[] = [];
  if (typeof s.boughtPastMonth === "number" && s.boughtPastMonth > 0) {
    floors.push({ value: s.boughtPastMonth, basis: "bought-in-past-month" });
  }
  if (typeof s.bsrDrops30d === "number" && s.bsrDrops30d > 0) {
    floors.push({ value: s.bsrDrops30d, basis: "bsr-drops" });
  }
  const model = typeof s.bsr === "number" && s.bsr > 0 ? modelMonthlySales(s.bsr, s.category) : undefined;

  if (floors.length > 0) {
    const best = floors.reduce((a, b) => (b.value > a.value ? b : a));
    // A floor can exceed the model (fast movers); never estimate below a floor.
    const point = Math.max(best.value, model ?? 0);
    return {
      monthlySales: Math.round(point),
      low: Math.round(best.value),
      high: Math.round(point * 1.3),
      basis: best.basis,
      confidence: best.basis === "bought-in-past-month" ? "high" : "medium",
    };
  }
  if (model !== undefined) {
    return {
      monthlySales: Math.round(model),
      low: Math.round(model * 0.7),
      high: Math.round(model * 1.3),
      basis: "bsr-model",
      confidence: "low",
    };
  }
  return { monthlySales: 0, low: 0, high: 0, basis: "none", confidence: "unknown" };
}

// Your expected share of sales: 1 / comparable FBA offers, halved when Amazon
// itself is on the listing.
export function buyBoxShare(s: VelocitySignals): number {
  const offers = Math.max(1, s.fbaOffers ?? 1);
  const share = 1 / offers;
  return s.amazonOnListing ? share * 0.5 : share;
}

// Expected days for `qty` units of yours to sell. Infinity when unknowable.
export function daysToClear(qty: number, est: VelocityEstimate, s: VelocitySignals): number {
  if (est.monthlySales <= 0) return Infinity;
  const daily = (est.monthlySales * buyBoxShare(s)) / 30;
  if (daily <= 0) return Infinity;
  return qty / daily;
}

// Largest quantity that still clears within `maxDays` (capped by `cap`).
export function suggestedQty(est: VelocityEstimate, s: VelocitySignals, maxDays: number, cap: number): number {
  if (est.monthlySales <= 0) return 0;
  const daily = (est.monthlySales * buyBoxShare(s)) / 30;
  return Math.max(0, Math.min(cap, Math.floor(daily * maxDays)));
}
