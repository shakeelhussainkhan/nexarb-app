// Smart sell-price engine (fee-stack aware).
// All fee figures here are ESTIMATES until real per-ASIN fee data (SP-API /
// Keepa) is wired in. Callers must surface that to the user — never present an
// estimated floor as exact.

export interface CostInputs {
  buyCost: number;
  prepPerUnit?: number; // 3PL prep: receiving, inspection, FNSKU, poly-bag
  inboundPerUnit?: number; // shipping from prep center into FBA
  fbaFee?: number; // fulfilment fee (estimate when omitted)
  storagePerUnit?: number; // expected storage over the holding window
  referralPct?: number; // marketplace referral fee fraction (e.g. 0.15)
}

// Rough standard-size FBA fulfilment fee bands (2026 published tiers,
// non-peak, incl. fuel surcharge ballpark). Estimate only.
export function estimateFbaFee(sellPrice: number): number {
  if (sellPrice <= 10) return 3.06;
  if (sellPrice <= 20) return 3.86;
  if (sellPrice <= 35) return 4.9;
  if (sellPrice <= 50) return 5.6;
  return 7.0;
}

// Common referral percentages by category (estimate; default 15%).
const REFERRAL_BY_CATEGORY: Record<string, number> = {
  electronics: 0.08,
  "consumer electronics": 0.08,
  "home & kitchen": 0.15,
  kitchen: 0.15,
  toys: 0.15,
  "toys & games": 0.15,
  beauty: 0.15,
  "health & household": 0.15,
  clothing: 0.17,
  "sports & outdoors": 0.15,
  outdoor: 0.15,
};

export function referralPctForCategory(category: string | undefined): number {
  if (!category) return 0.15;
  return REFERRAL_BY_CATEGORY[category.trim().toLowerCase()] ?? 0.15;
}

function landedCosts(c: CostInputs) {
  return {
    prep: c.prepPerUnit ?? 1.25,
    inbound: c.inboundPerUnit ?? 0.45,
    storage: c.storagePerUnit ?? 0.35,
  };
}

// Break-even sell price at a target net margin:
//   floor = (buy + prep + inbound + fba + storage) / (1 - referral - margin)
export function floorPrice(c: CostInputs, targetMarginPct: number): number {
  const { prep, inbound, storage } = landedCosts(c);
  const fba = c.fbaFee ?? estimateFbaFee(c.buyCost * 2);
  const referral = c.referralPct ?? 0.15;
  const denom = 1 - referral - targetMarginPct;
  if (denom <= 0) return Infinity;
  return (c.buyCost + prep + inbound + fba + storage) / denom;
}

export interface PriceOutcome {
  netProfit: number; // per unit, after referral + all costs
  marginPct: number; // netProfit / sell price
  roiPct: number; // netProfit / (buy + prep + inbound)
}

// Net outcome of selling one unit at `sellPrice`.
export function outcomeAtPrice(sellPrice: number, c: CostInputs): PriceOutcome {
  const { prep, inbound, storage } = landedCosts(c);
  const fba = c.fbaFee ?? estimateFbaFee(sellPrice);
  const referral = c.referralPct ?? 0.15;
  const netProfit = sellPrice - referral * sellPrice - c.buyCost - prep - inbound - fba - storage;
  const landed = c.buyCost + prep + inbound;
  return {
    netProfit,
    marginPct: sellPrice > 0 ? netProfit / sellPrice : 0,
    roiPct: landed > 0 ? netProfit / landed : 0,
  };
}
