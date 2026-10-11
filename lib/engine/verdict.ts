// Joint deal verdict: velocity gate + smart sell price, evaluated together.
// BUY requires BOTH: realistic price clears the fee-stack floor at target
// margin, AND the proposed quantity clears inside the velocity window.
// Errors or missing inputs resolve to UNKNOWN — never to BUY.

import { floorPrice, outcomeAtPrice, referralPctForCategory, type CostInputs } from "./pricing.ts";
import { estimateVelocity, daysToClear, suggestedQty, type VelocitySignals } from "./velocity.ts";

export interface DealForVerdict {
  buyPrice: number;
  sellPrice: number; // current observed sell price (spot)
  realisticPrice?: number; // e.g. 90-day median Buy Box when history exists
  bsr?: number;
  category?: string;
}

export interface VerdictOptions {
  targetMarginPct?: number; // default 0.20
  maxClearDays?: number; // default 45
  qty?: number; // proposed buy quantity, default 10
  maxUnitsPerAsin?: number; // founder guardrail cap, default 20
  costs?: Partial<CostInputs>;
}

export interface DealVerdict {
  verdict: "BUY" | "SKIP" | "UNKNOWN";
  reasons: string[];
  floorPrice: number;
  realisticPrice: number;
  netProfitAtRealistic: number;
  marginAtRealistic: number;
  estMonthlySales: number;
  velocityBasis: string;
  velocityConfidence: string;
  daysToClear: number | null; // null = unknowable
  suggestedQty: number;
}

export function evaluateDeal(deal: DealForVerdict, opts: VerdictOptions = {}): DealVerdict {
  const targetMargin = opts.targetMarginPct ?? 0.2;
  const maxClearDays = opts.maxClearDays ?? 45;
  const qty = opts.qty ?? 10;
  const cap = opts.maxUnitsPerAsin ?? 20;
  const reasons: string[] = [];

  const costs: CostInputs = {
    buyCost: deal.buyPrice,
    referralPct: referralPctForCategory(deal.category),
    ...opts.costs,
  };
  costs.buyCost = deal.buyPrice; // the deal's own buy price always wins

  const floor = floorPrice(costs, targetMargin);
  // Without price history, the spot price is all we have — flag it in reasons.
  const realistic = deal.realisticPrice ?? deal.sellPrice;
  const outcome = outcomeAtPrice(realistic, costs);

  const signals: VelocitySignals = { bsr: deal.bsr, category: deal.category };
  const est = estimateVelocity(signals);
  const clear = daysToClear(qty, est, signals);
  const suggested = suggestedQty(est, signals, maxClearDays, cap);

  let verdict: DealVerdict["verdict"] = "BUY";

  if (!(deal.buyPrice > 0) || !(deal.sellPrice > 0)) {
    verdict = "UNKNOWN";
    reasons.push("Missing buy/sell price — cannot evaluate.");
  }
  if (est.confidence === "unknown") {
    verdict = "UNKNOWN";
    reasons.push("No velocity signal (no BSR) — cannot estimate sell-through.");
  }

  if (verdict !== "UNKNOWN") {
    if (realistic < floor) {
      verdict = "SKIP";
      reasons.push(
        `Realistic price $${realistic.toFixed(2)} is below floor $${floor.toFixed(2)} at ${(targetMargin * 100).toFixed(0)}% target margin.`
      );
    }
    if (!isFinite(clear) || clear > maxClearDays) {
      verdict = "SKIP";
      reasons.push(
        isFinite(clear)
          ? `~${Math.round(clear)} days to clear ${qty} units exceeds the ${maxClearDays}-day window (est. ${est.monthlySales}/mo, ${est.basis}).`
          : "Sell-through unknowable from available signals."
      );
    }
  }

  if (verdict === "BUY") {
    reasons.push(
      `Clears in ~${Math.round(clear)}d at est. ${est.monthlySales} sales/mo (${est.basis}, ${est.confidence} confidence); net $${outcome.netProfit.toFixed(2)}/unit at realistic price.`
    );
    if (!deal.realisticPrice) reasons.push("Priced on spot sell price — no 90-day history wired yet.");
    if (est.confidence === "low") reasons.push("Velocity is BSR-model only (±30%) — Keepa data not yet wired.");
  }

  return {
    verdict,
    reasons,
    floorPrice: Math.round(floor * 100) / 100,
    realisticPrice: realistic,
    netProfitAtRealistic: Math.round(outcome.netProfit * 100) / 100,
    marginAtRealistic: Math.round(outcome.marginPct * 1000) / 10,
    estMonthlySales: est.monthlySales,
    velocityBasis: est.basis,
    velocityConfidence: est.confidence,
    daysToClear: isFinite(clear) ? Math.round(clear * 10) / 10 : null,
    suggestedQty: suggested,
  };
}
