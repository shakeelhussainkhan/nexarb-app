// Joint deal verdict: velocity gate + smart sell price, evaluated together.
// BUY requires BOTH: realistic price clears the fee-stack floor at target
// margin, AND the proposed quantity clears inside the velocity window.
// Errors or missing inputs resolve to UNKNOWN — never to BUY.

import { floorPrice, outcomeAtPrice, referralPctForCategory, type CostInputs } from "./pricing.ts";
import { estimateVelocity, daysToClear, suggestedQty, type VelocitySignals } from "./velocity.ts";
import { WFS_FULFILLMENT_FEE_ESTIMATE } from "@/lib/walmart/pricing.ts";

export interface DealForVerdict {
  buyPrice: number;
  sellPrice: number; // current observed sell price (spot)
  realisticPrice?: number; // e.g. 90-day median Buy Box when history exists
  bsr?: number;
  category?: string;
  // Snapshot-aware override: when first-party snapshots exist for the ASIN,
  // derive signals via snapshotsToVelocitySignals() and pass them here. When
  // absent, evaluateDeal falls back to the legacy bsr/category model path.
  velocitySignals?: VelocitySignals;
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

  const signals: VelocitySignals = deal.velocitySignals ?? { bsr: deal.bsr, category: deal.category };
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
    if (est.confidence === "low") reasons.push("Velocity is BSR-model only (±30%) — NexArb price history not yet wired.");
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

// --- Multi-channel evaluation (Amazon FBA vs Walmart WFS) -------------------
// Each channel is evaluated with the shared evaluateDeal() machinery and its
// own cost stack (FBA fees for Amazon, WFS fee stack for Walmart). The deal
// goes to the channel with the best per-unit net profit among BUY-eligible
// channels; SKIP when priced but nothing clears; UNKNOWN only when no
// channel has price data at all.

export type SalesChannel = "amazon-fba" | "walmart-wfs";

export interface ChannelPriceInput {
  sellPrice: number | null; // live sell price on this channel, null = unknown
  source: string; // provenance label, e.g. "sp-api-pricing" / "unavailable"
  reason?: string; // why the price is missing, when known
}

export interface ChannelEvaluation {
  channel: SalesChannel;
  sellPrice: number | null;
  sellPriceSource: string;
  floorPrice: number; // break-even at target margin with this channel's costs
  netProfit: number; // per unit at sell price (0 when no price data)
  marginPct: number; // netProfit / sell price, as percent (0 when no price)
  verdict: "BUY" | "SKIP" | "UNKNOWN";
  reasons: string[];
}

export interface ChannelsForVerdict {
  buyPrice: number;
  category?: string;
  amazon: ChannelPriceInput;
  walmart: ChannelPriceInput;
  // Velocity signals are Amazon-derived (BSR model) until Walmart sell-
  // through data exists — shared across channels by design, flagged in the
  // BUY reasons via evaluateDeal's existing confidence notes.
  bsr?: number;
  velocitySignals?: VelocitySignals;
  qty?: number;
  targetMarginPct?: number;
  maxClearDays?: number;
  maxUnitsPerAsin?: number;
}

// DealVerdict headline fields + the per-channel breakdown. Headline fields
// always describe the lead channel (the chosen one when BUY-eligible,
// otherwise the best-priced channel) so existing single-channel consumers
// keep working unchanged.
export interface ChannelsVerdict extends DealVerdict {
  channels: ChannelEvaluation[];
  chosenChannel: SalesChannel | null; // set only when a channel is BUY-eligible
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function evaluateChannels(input: ChannelsForVerdict): ChannelsVerdict {
  const targetMargin = input.targetMarginPct ?? 0.2;
  const signals: VelocitySignals = input.velocitySignals ?? {
    bsr: input.bsr,
    category: input.category,
  };

  // Channel-appropriate costs through the shared fee-stack math:
  //  - amazon-fba: referral % by category + FBA tier estimate (the defaults).
  //  - walmart-wfs: same referral-% proxy + the flat WFS fulfillment ESTIMATE
  //    standing in for the FBA fee input (documented in wfsFeeStack).
  const channelCosts: Record<SalesChannel, Partial<CostInputs>> = {
    "amazon-fba": { referralPct: referralPctForCategory(input.category) },
    "walmart-wfs": {
      referralPct: referralPctForCategory(input.category),
      fbaFee: WFS_FULFILLMENT_FEE_ESTIMATE,
    },
  };

  const perChannel: Array<{ eval: ChannelEvaluation; full: DealVerdict | null }> = (
    ["amazon-fba", "walmart-wfs"] as SalesChannel[]
  ).map((channel) => {
    const priceInput = channel === "amazon-fba" ? input.amazon : input.walmart;
    const label = channel === "amazon-fba" ? "Amazon" : "Walmart";
    const costs: CostInputs = {
      buyCost: input.buyPrice,
      ...channelCosts[channel],
    };
    if (!(typeof priceInput.sellPrice === "number") || !(priceInput.sellPrice > 0)) {
      return {
        eval: {
          channel,
          sellPrice: null,
          sellPriceSource: priceInput.source,
          floorPrice: round2(floorPrice(costs, targetMargin)),
          netProfit: 0,
          marginPct: 0,
          verdict: "UNKNOWN" as const,
          reasons: [
            `No ${label} sell price — cannot evaluate this channel.` +
              (priceInput.reason ? ` (${priceInput.reason})` : ""),
          ],
        },
        full: null,
      };
    }
    const full = evaluateDeal(
      {
        buyPrice: input.buyPrice,
        sellPrice: priceInput.sellPrice,
        category: input.category,
        velocitySignals: signals,
      },
      {
        qty: input.qty,
        targetMarginPct: targetMargin,
        maxClearDays: input.maxClearDays,
        maxUnitsPerAsin: input.maxUnitsPerAsin,
        costs: channelCosts[channel],
      }
    );
    return {
      eval: {
        channel,
        sellPrice: priceInput.sellPrice,
        sellPriceSource: priceInput.source,
        floorPrice: full.floorPrice,
        netProfit: full.netProfitAtRealistic,
        marginPct: full.marginAtRealistic,
        verdict: full.verdict,
        reasons: full.reasons,
      },
      full,
    };
  });

  const channels = perChannel.map((p) => p.eval);
  const bestOf = (list: ChannelEvaluation[]): ChannelEvaluation =>
    list.reduce((a, b) => (b.netProfit > a.netProfit ? b : a));

  // Pick the best net profit AMONG BUY-eligible channels — a SKIP channel can
  // out-earn a BUY channel on paper (e.g. price above floor but velocity
  // fails), and must not win.
  const buyable = channels.filter((c) => c.verdict === "BUY");
  const chosenEval = buyable.length > 0 ? bestOf(buyable) : null;
  const priced = channels.filter((c) => c.sellPrice !== null);
  const leadEval = chosenEval ?? (priced.length > 0 ? bestOf(priced) : null);
  const leadFull =
    perChannel.find((p) => p.eval === leadEval)?.full ?? null;

  const base: DealVerdict = leadFull ?? {
    verdict: "UNKNOWN",
    reasons: [
      "No live sell price on any channel — cannot evaluate.",
      ...channels.flatMap((c) => c.reasons.map((r) => `${c.channel}: ${r}`)),
    ],
    floorPrice: 0,
    realisticPrice: 0,
    netProfitAtRealistic: 0,
    marginAtRealistic: 0,
    estMonthlySales: 0,
    velocityBasis: "none",
    velocityConfidence: "unknown",
    daysToClear: null,
    suggestedQty: 0,
  };

  const reasons: string[] = [...base.reasons];
  if (chosenEval) {
    reasons.unshift(
      `Channel chosen: ${chosenEval.channel} — best net profit ($${chosenEval.netProfit.toFixed(2)}/unit) among BUY-eligible channels.`
    );
  } else if (leadEval) {
    reasons.unshift(
      `No channel is BUY-eligible at target margin/velocity window — best is ${leadEval.channel} (net $${leadEval.netProfit.toFixed(2)}/unit, ${leadEval.verdict}).`
    );
  }

  return {
    ...base,
    reasons,
    channels,
    chosenChannel: chosenEval ? chosenEval.channel : null,
  };
}
