// Pure evaluation core for supplier offers (NexArb Phase 1.5: turning
// ingested/matched/priced supplier_offers into vetted order candidates).
//
// The ingest pipeline (lib/suppliers/offers.ts) stores a live Amazon price
// and an ESTIMATED net/margin per offer. That is a spreadsheet of spreads,
// not a decision. This module is the decision: it weighs the signals the
// rest of NexArb already trusts —
//
//   * freight-aware economics (the pricing.ts fee stack via
//     estimateSupplierNet, minus an explicit freight assumption),
//   * sales velocity from the app's own BSR→sales model
//     (lib/engine/velocity.ts estimateVelocity),
//   * sell eligibility from SP-API Listings Restrictions (as classified by
//     lib/engine/eligibility.ts and mapped by the caller),
//   * supplier stock, and
//   * a bounded Q4 seasonal boost for giftable/hosting categories,
//
// and emits a verdict + 0–100 score + human-readable reasons.
//
// PACK NORMALIZATION (lib/suppliers/packNormalizeCore.ts): the stored
// Amazon price is the price of whatever the matched listing sells —
// which is often a CASE PACK, while the supplier cost is per single
// unit. Before any economics run, the listing's own pack declaration
// (and the supplier UPC's shape) establish the per-unit price basis:
// economics, margin and score are computed on amazonPrice ÷ packQty,
// and the normalization is stated in the reasons. A case-level
// GTIN-14 supplier UPC makes the feed's unit definition untrustworthy
// (case identifiers wrapped around a per-unit price) — such offers
// return "pass" with the reason recorded and never surface as
// candidates. When the caller supplies no listing title at all, no
// pack check is possible and the price is treated as a single unit
// exactly as before (the verify-evaluate.mjs contract is unchanged).
//
// VERDICT RULES (the whole contract — keep in sync with the harness):
//   candidate — freight-aware net >= $5/unit AND freight-aware margin
//               >= 20% AND velocity is not "weak" AND the supplier has
//               stock (qty > 0; qty unknown — e.g. Frontier's files carry
//               no counts — also passes this gate).
//   watch     — profitable after freight (net > 0 and margin > 0) but at
//               least one candidate condition fails: thin net/margin, weak
//               or unproven velocity, or supplier out of stock.
//   pass      — everything else: unprofitable after freight, no usable
//               Amazon price, or eligibility BLOCKED (the account cannot
//               list the ASIN at all — no economics rescue that).
//   Eligibility APPROVAL_REQUIRED never blocks "candidate": the brand
//   approval is applied for WITH the distributor invoice, and an invoice
//   from this very order is the qualifying document — the verdict carries
//   the reason "gated: needs approval — invoice from this order qualifies"
//   so the founder sees the extra step before promoting.
//
// FREIGHT MODEL (explicit, never hidden): Petra ships free on orders
// >= $800. A single candidate rarely reaches that alone, so by default
// freight is modelled per unit as freightRatePct (default 8%) of the
// supplier cost, and the reason string says so. Pass { freightFree: true }
// ONLY when the order being modelled genuinely reaches the threshold
// (e.g. a batched order) — then freight is $0 and the reason says that
// instead. Every output is still an ESTIMATE built on estimated fees.
//
// Pure (no IO) so scripts/verify-evaluate.mjs can drive every rule branch.

import { estimateSupplierNet } from "./petraCore";
import { estimateVelocity } from "@/lib/engine/velocity";
import {
  analyzeListingPack,
  type PackNormalizationStatus,
} from "./packNormalizeCore";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

/** Eligibility as consumed here — mapped by the caller from
 * lib/engine/eligibility.ts states: SELLABLE → ELIGIBLE,
 * APPROVAL_REQUIRED → APPROVAL_REQUIRED, BLOCKED → BLOCKED,
 * UNKNOWN → UNKNOWN. */
export type EvalEligibility = "APPROVAL_REQUIRED" | "ELIGIBLE" | "BLOCKED" | "UNKNOWN";

export type EvalVerdict = "candidate" | "watch" | "pass";
export type VelocityClass = "strong" | "steady" | "weak" | "unknown";

export interface OfferForEval {
  supplier: string;
  title: string;
  brand?: string | null;
  productClass?: string | null;
  subcategory?: string | null;
  costPrice: number;
}

export interface EvalSignals {
  /** Live Amazon landed price for the matched ASIN (from the pricing pass). */
  amazonPrice: number;
  /** Current sales rank from SP-API Catalog Items, when obtainable. */
  bsr: number | null;
  /** Category for the BSR model (catalog category preferred; falls back to
   * the offer's productClass/subcategory in the caller). */
  category?: string | null;
  eligibility: EvalEligibility;
  /** Supplier on-hand qty; null = the feed carries no counts (Frontier). */
  stockAtSupplier: number | null;
  /** Amazon listing title for the matched ASIN (live Catalog title,
   * or the title persisted on the offer row). When present (even
   * null), pack normalization runs and its outcome is recorded in the
   * reasons; when the field is absent entirely, no pack check is
   * possible and the price is treated as a single unit, as before. */
  listingTitle?: string | null;
  /** The supplier feed's UPC for this offer — its shape (each vs
   * case-level GTIN-14) gates whether per-unit economics are
   * trustworthy at all. See lib/suppliers/packNormalizeCore.ts. */
  supplierUpc?: string | null;
}

export interface EvalOptions {
  /** Model the order as reaching Petra's $800 free-freight threshold.
   * Default false — see the freight note in the file header. */
  freightFree?: boolean;
  /** Freight as a fraction of supplier cost per unit when not freight-free.
   * Default DEFAULT_FREIGHT_RATE (0.08). */
  freightRatePct?: number;
}

export interface OfferEvaluation {
  verdict: EvalVerdict;
  /** 0–100 composite (see score composition below). */
  score: number;
  /** Human-readable reasons: freight assumption first, then economics,
   * velocity, eligibility, stock, seasonal, rule explanations. */
  reasons: string[];
  /** Net per unit AFTER the modelled freight (2dp). */
  freightNet: number;
  /** Margin after freight, as a PERCENT of the Amazon price (1dp). */
  freightMarginPct: number;
  /** Modelled freight per unit (2dp); 0 when freightFree. */
  freightPerUnit: number;
  /** estimateSupplierNet output BEFORE freight, for transparency. */
  baseNet: number;
  baseMarginPct: number;
  velocityClass: VelocityClass;
  /** Modelled monthly unit sales from the BSR model; null when no BSR. */
  estMonthlySales: number | null;
  /** Seasonal groups matched (subset of SEASONAL_TERMS labels). */
  seasonalGroups: string[];
  /** Pack quantity the listing price was divided by (1 = single unit
   * or no pack check possible). */
  packQty: number;
  /** "unverified_case_upc" when the supplier UPC is a case-level
   * GTIN-14 and per-unit economics were refused outright. */
  packStatus: PackNormalizationStatus;
  /** Per-unit Amazon price the economics ran on (amazonPrice ÷
   * packQty); null when refused or when the price was unusable. */
  unitAmazonPrice: number | null;
}

// ---------------------------------------------------------------------------
// Rule constants (named so the rules above stay honest).
// ---------------------------------------------------------------------------

/** Candidate bar: freight-aware net per unit, USD. */
export const CANDIDATE_MIN_NET = 5;
/** Candidate bar: freight-aware margin, percent of Amazon price. */
export const CANDIDATE_MIN_MARGIN_PCT = 20;
/** Default freight model: 8% of supplier cost per unit (orders modelled
 * below Petra's $800 free-freight threshold). */
export const DEFAULT_FREIGHT_RATE = 0.08;
/** Velocity classes by modelled monthly unit sales (BSR model output):
 * strong ≥ 300/mo (~10/day), steady ≥ 90/mo (~3/day), below that weak. */
export const VELOCITY_STRONG_MONTHLY = 300;
export const VELOCITY_STEADY_MONTHLY = 90;
/** Seasonal score bump when any seasonal group matches (bounded, once). */
export const SEASONAL_SCORE_BUMP = 10;

// ---------------------------------------------------------------------------
// Seasonal weighting (Q4). Pure data: group label → lowercase terms matched
// against title + subcategory + productClass. A match adds ONE bounded
// score bump (SEASONAL_SCORE_BUMP) and one reason per matched group,
// "seasonal: <group>". Non-seasonal items are completely unaffected.
// ---------------------------------------------------------------------------

export const SEASONAL_TERMS: Array<{ group: string; terms: string[] }> = [
  {
    group: "toys & games",
    terms: ["toy", "puzzle", "plush", "doll", "board game", "building set", "remote control car", "rc truck", "action figure", "playset"],
  },
  {
    group: "kitchen small appliances",
    terms: ["slow cooker", "waffle", "blender", "toaster", "coffee maker", "espresso", "air fryer", "griddle", "stand mixer", "hand mixer", "electric kettle", "food processor", "popcorn maker", "ice maker"],
  },
  {
    group: "batteries",
    terms: ["alkaline", "batteries", "battery pack", "aa battery", "aaa battery", "lithium battery", "rechargeable batteries"],
  },
  {
    group: "audio",
    terms: ["speaker", "headphones", "earbuds", "soundbar", "turntable", "subwoofer", "boombox"],
  },
  {
    group: "home fragrance & diffusers",
    terms: ["diffuser", "essential oil", "fragrance oil", "scented candle", "aromatherapy", "reed diffuser"],
  },
  {
    group: "holiday baking",
    terms: ["baking mix", "vanilla extract", "baking spice", "cookie mix", "cake mix", "gingerbread", "pumpkin spice"],
  },
  {
    group: "lights & decor",
    terms: ["string lights", "led strip", "christmas", "wreath", "ornament", "holiday decor", "fairy lights", "night light"],
  },
  {
    group: "giftable personal care",
    terms: ["massager", "gift set", "hair dryer", "electric shaver", "grooming kit", "beard kit", "skincare set", "manicure set"],
  },
];

/** Seasonal groups whose terms appear in the offer's title/subcategory/
 * productClass (case-insensitive substring match). */
export function seasonalGroupsFor(offer: {
  title?: string | null;
  subcategory?: string | null;
  productClass?: string | null;
}): string[] {
  const haystack = [offer.title ?? "", offer.subcategory ?? "", offer.productClass ?? ""]
    .join(" ")
    .toLowerCase();
  if (!haystack.trim()) return [];
  const matched: string[] = [];
  for (const { group, terms } of SEASONAL_TERMS) {
    if (terms.some((t) => haystack.includes(t))) matched.push(group);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Velocity classification — the app's own BSR→sales model, bucketed.
// ---------------------------------------------------------------------------

export function classifyVelocity(
  bsr: number | null,
  category?: string | null
): { cls: VelocityClass; monthlySales: number | null } {
  if (typeof bsr !== "number" || !Number.isFinite(bsr) || bsr <= 0) {
    return { cls: "unknown", monthlySales: null };
  }
  const est = estimateVelocity({ bsr, category: category ?? undefined });
  const monthly = est.monthlySales;
  if (monthly >= VELOCITY_STRONG_MONTHLY) return { cls: "strong", monthlySales: monthly };
  if (monthly >= VELOCITY_STEADY_MONTHLY) return { cls: "steady", monthlySales: monthly };
  return { cls: "weak", monthlySales: monthly };
}

// ---------------------------------------------------------------------------
// The evaluation.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function evaluateOffer(
  offer: OfferForEval,
  signals: EvalSignals,
  opts: EvalOptions = {}
): OfferEvaluation {
  const reasons: string[] = [];
  const freightFree = opts.freightFree ?? false;
  const freightRate = opts.freightRatePct ?? DEFAULT_FREIGHT_RATE;

  const velocity = classifyVelocity(signals.bsr, signals.category);
  const seasonalGroups = seasonalGroupsFor(offer);

  // Pack normalization — establish the per-unit price basis BEFORE any
  // economics (see the header note). Runs only when the caller supplied
  // pack inputs (either field present); when neither is supplied the
  // price is treated as a single unit exactly as before.
  const pack =
    signals.listingTitle !== undefined || signals.supplierUpc !== undefined
      ? analyzeListingPack({
          listingTitle: signals.listingTitle,
          upc: signals.supplierUpc,
          amazonPrice: signals.amazonPrice,
        })
      : null;
  const effectivePrice =
    pack && pack.status === "ok" && pack.unitAmazonPrice !== null
      ? pack.unitAmazonPrice
      : signals.amazonPrice;

  const base = estimateSupplierNet(
    {
      costPrice: offer.costPrice,
      productClass: offer.productClass,
      subcategory: offer.subcategory,
    },
    effectivePrice
  );

  // Freight assumption — ALWAYS stated in the reasons (first entry), so a
  // reader never has to guess which model produced the numbers.
  const freightPerUnit = !base || freightFree ? 0 : round2(offer.costPrice * freightRate);
  if (freightFree) {
    reasons.push(
      "freight: $0/unit — order modelled at/above the $800 free-freight threshold"
    );
  } else {
    reasons.push(
      `freight: est. $${freightPerUnit.toFixed(2)}/unit at ${Math.round(freightRate * 100)}% of supplier cost (order below the $800 free-freight threshold)`
    );
  }

  // Case-level GTIN-14 supplier UPC: the feed's unit definition is
  // unverified (case identifiers wrapped around a per-unit price), so
  // no per-unit economics are candidate-grade. Hard pass, reason
  // recorded — the offer must not surface as a candidate.
  if (pack && pack.status === "unverified_case_upc") {
    reasons.push(
      `pack_check: unverified case UPC — supplier UPC ${signals.supplierUpc ?? ""} is a case-level GTIN-14, so the feed's unit definition cannot be trusted and per-unit economics are not candidate-grade; excluded from candidates until the supplier unit is confirmed`
    );
    return {
      verdict: "pass",
      score: 0,
      reasons,
      freightNet: 0,
      freightMarginPct: 0,
      freightPerUnit: 0,
      baseNet: 0,
      baseMarginPct: 0,
      velocityClass: velocity.cls,
      estMonthlySales: velocity.monthlySales,
      seasonalGroups,
      packQty: pack.packQty,
      packStatus: pack.status,
      unitAmazonPrice: null,
    };
  }

  // Pack outcome reasons — every normalization (and every unverifiable
  // single-unit assumption) is on the record.
  if (pack) {
    if (pack.packQty > 1) {
      reasons.push(
        `pack_normalized: listing pack of ${pack.packQty} → unit price $${effectivePrice.toFixed(2)} (Amazon price $${signals.amazonPrice.toFixed(2)} ÷ ${pack.packQty}; ${pack.pack.evidence})`
      );
    } else if (pack.pack.confidence === "none") {
      reasons.push(
        signals.listingTitle
          ? "pack_check: no explicit pack declaration in the Amazon listing title — price treated as a single unit (low-confidence)"
          : "pack_check: Amazon listing title unavailable — pack size unverified, price treated as a single unit (low-confidence)"
      );
    }
  }

  if (!base) {
    reasons.push("no usable Amazon price or supplier cost — cannot evaluate economics");
    return {
      verdict: "pass",
      score: 0,
      reasons,
      freightNet: 0,
      freightMarginPct: 0,
      freightPerUnit: 0,
      baseNet: 0,
      baseMarginPct: 0,
      velocityClass: velocity.cls,
      estMonthlySales: velocity.monthlySales,
      seasonalGroups,
      packQty: pack?.packQty ?? 1,
      packStatus: pack?.status ?? "ok",
      unitAmazonPrice: pack ? pack.unitAmazonPrice : signals.amazonPrice,
    };
  }

  const freightNet = round2(base.net - freightPerUnit);
  const freightMarginPct = round1((freightNet / effectivePrice) * 100);
  const profitable = freightNet > 0 && freightMarginPct > 0;

  // Velocity reason.
  if (velocity.cls === "unknown") {
    reasons.push("velocity: unknown — no sales-rank data for this ASIN");
  } else {
    reasons.push(
      `velocity: ${velocity.cls} (~${velocity.monthlySales}/mo est. from BSR ${signals.bsr})`
    );
  }

  // Eligibility reasons. APPROVAL_REQUIRED never blocks candidate (see
  // header); BLOCKED forces pass below.
  if (signals.eligibility === "APPROVAL_REQUIRED") {
    reasons.push("gated: needs approval — invoice from this order qualifies");
  } else if (signals.eligibility === "BLOCKED") {
    reasons.push("eligibility: blocked — this account cannot list this ASIN");
  } else if (signals.eligibility === "UNKNOWN") {
    reasons.push("eligibility: unknown — sellability not confirmed");
  } else {
    reasons.push("eligibility: confirmed sellable");
  }

  // Stock reasons (only when notable).
  const stockOk = signals.stockAtSupplier === null || signals.stockAtSupplier > 0;
  if (signals.stockAtSupplier === null) {
    reasons.push("supplier stock: unknown — feed carries no stock counts");
  } else if (signals.stockAtSupplier === 0) {
    reasons.push("supplier stock: out of stock");
  }

  // Seasonal reasons.
  for (const group of seasonalGroups) reasons.push(`seasonal: ${group}`);

  // ---- Verdict (rules in the file header) --------------------------------
  let verdict: EvalVerdict;
  if (signals.eligibility === "BLOCKED") {
    verdict = "pass";
  } else if (
    freightNet >= CANDIDATE_MIN_NET &&
    freightMarginPct >= CANDIDATE_MIN_MARGIN_PCT &&
    velocity.cls !== "weak" &&
    stockOk
  ) {
    verdict = "candidate";
  } else if (profitable) {
    verdict = "watch";
    // Explain exactly which candidate condition(s) failed.
    if (freightNet < CANDIDATE_MIN_NET) {
      reasons.push(`watch: freight-aware net $${freightNet.toFixed(2)} is below the $${CANDIDATE_MIN_NET} candidate bar`);
    }
    if (freightMarginPct < CANDIDATE_MIN_MARGIN_PCT) {
      reasons.push(`watch: freight-aware margin ${freightMarginPct.toFixed(1)}% is below the ${CANDIDATE_MIN_MARGIN_PCT}% candidate bar`);
    }
    if (velocity.cls === "weak") {
      reasons.push("watch: velocity is weak — slow mover at the current rank");
    }
    if (!stockOk) {
      reasons.push("watch: supplier is out of stock");
    }
  } else {
    verdict = "pass";
    reasons.push(`pass: not profitable after freight (net $${freightNet.toFixed(2)}, margin ${freightMarginPct.toFixed(1)}%)`);
  }

  // ---- Score (0–100 composite; documented weights) ------------------------
  //   margin  0–40  (freight-aware margin, 50% saturates)
  //   net     0–20  ($25/unit saturates)
  //   velocity 25 strong / 15 steady / 10 unknown / 5 weak
  //   stock   5 in stock / 3 unknown / 0 out of stock
  //   seasonal +10 when any seasonal group matches (bounded)
  // BLOCKED eligibility caps the total at 10: unlistable inventory is
  // never a shortlist item no matter how good the spreadsheet looks.
  const marginScore = (clamp(freightMarginPct, 0, 50) / 50) * 40;
  const netScore = (clamp(freightNet, 0, 25) / 25) * 20;
  const velocityScore =
    velocity.cls === "strong" ? 25 : velocity.cls === "steady" ? 15 : velocity.cls === "unknown" ? 10 : 5;
  const stockScore = signals.stockAtSupplier === null ? 3 : signals.stockAtSupplier > 0 ? 5 : 0;
  const seasonalScore = seasonalGroups.length > 0 ? SEASONAL_SCORE_BUMP : 0;
  let score = Math.round(marginScore + netScore + velocityScore + stockScore + seasonalScore);
  score = clamp(score, 0, 100);
  if (signals.eligibility === "BLOCKED") score = Math.min(score, 10);

  return {
    verdict,
    score,
    reasons,
    freightNet,
    freightMarginPct,
    freightPerUnit,
    baseNet: base.net,
    baseMarginPct: base.marginPct,
    velocityClass: velocity.cls,
    estMonthlySales: velocity.monthlySales,
    seasonalGroups,
    packQty: pack?.packQty ?? 1,
    packStatus: pack?.status ?? "ok",
    unitAmazonPrice: pack ? pack.unitAmazonPrice : signals.amazonPrice,
  };
}
