// Pure suspect-multipack guard for supplier offers (NexArb v3): catch
// the multipack mirages that pack normalization (packNormalizeCore.ts)
// cannot see.
//
// THE REMAINING DEFECT (verified 2026-10-17 by hand-vetting the v2
// top-10 Frontier candidates after the refresh): parser v2 fixed every
// pack the LISTING TITLE declares — but on the surviving mirages the
// pack count lives in the listing BODY, not the title the pipeline
// reads, so the parser sees no declaration, treats the Amazon price
// as a single unit, and the evaluator pairs a multipack total with a
// per-unit supplier cost. 14 of the 15 vetted mirages shared one
// fingerprint: Amazon price ÷ supplier unit cost above 4× with NO
// confirmed pack declaration (Simply Organic black pepper $62.04 vs
// ~$8 single cost; Wholesome agave and honey cases; Smith Tea cases;
// Chocolove by the box). A >4× price/cost ratio on grocery/pantry
// staples is almost never a real arbitrage — it is an undeclared
// case/pack mismatch.
//
// WHAT THIS MODULE DECIDES (pure, no IO — it produces no economics of
// its own; the evaluator keeps owning the fee math):
//   suspect when the price/cost ratio, AFTER dividing the Amazon
//   price by any CONFIRMED pack quantity, still exceeds
//   SUSPECT_RATIO_THRESHOLD (4.0). "Confirmed" means the v2 parser
//   established packQty > 1 with explicit/derived evidence — the same
//   PackDetection the evaluator already computed (callers pass it in;
//   standalone callers may omit it and this module derives it from the
//   listing title with the SAME parser — there is no second parser).
//   A confirmed pack whose normalized ratio falls to ≤ 4× EXPLAINS
//   the spread and is not suspect; a confirmed pack that still leaves
//   the ratio above 4× does not rescue the offer.
//
// CONSERVATISM: this guard only ever suppresses. A suspect offer is
// excluded from candidates (the caller forces verdict "pass" and
// records the reason), never silently repriced — a human can still
// find it by its "suspect_multipack:" reason and its stored ratio.

import {
  detectListingPackQty,
  type PackConfidence,
} from "./packNormalizeCore";

/** Price/cost ratio above which an unexplained spread is treated as
 * an undeclared case/pack mismatch rather than arbitrage. The vetted
 * mirage fingerprint was >4× (most were 6–15×); legitimate
 * high-margin singles in the catalog sit below it. */
export const SUSPECT_RATIO_THRESHOLD = 4.0;

export interface SuspectMultipackInput {
  /** Stored Amazon price for the matched ASIN (the listing total). */
  amazonPrice: number;
  /** Supplier cost per supplier unit (the offer's cost_price). */
  supplierUnitCost: number;
  /** Pack quantity already established by pack normalization
   * (analyzeListingPack), when the caller has it. Only counts as
   * confirmed alongside a non-"none" packConfidence. When omitted,
   * the pack is derived from listingTitle with the v2 parser. */
  packQty?: number | null;
  /** Confidence from the same pack analysis ("explicit" | "derived"
   * | "none"). A "none" confidence never confirms a pack. */
  packConfidence?: PackConfidence | null;
  /** Amazon listing title — used to derive the pack only when the
   * caller supplied no packQty of its own. */
  listingTitle?: string | null;
}

export interface SuspectMultipackVerdict {
  suspect: boolean;
  /** amazonPrice ÷ supplierUnitCost, 2dp. Null when either input is
   * unusable (no ratio exists to judge). */
  ratio: number | null;
  /** ratio ÷ confirmed packQty, 2dp — the ratio the verdict uses.
   * Equals ratio when no pack is confirmed. Null when ratio is. */
  normalizedRatio: number | null;
  /** Confirmed pack quantity applied (1 = none confirmed). */
  packQty: number;
  /** Audit sentence; the suspect form is what lands in eval reasons,
   * prefixed "suspect_multipack:". */
  reason: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtRatio = (n: number) => `${round2(n).toFixed(2)}×`;

/**
 * Judge one offer's price/cost spread. Pure and total: unusable
 * inputs yield suspect=false with null ratios (the evaluator's own
 * "no usable price" path already handles those offers).
 */
export function detectSuspectMultipack(
  input: SuspectMultipackInput
): SuspectMultipackVerdict {
  const { amazonPrice, supplierUnitCost } = input;
  if (
    !Number.isFinite(amazonPrice) ||
    amazonPrice <= 0 ||
    !Number.isFinite(supplierUnitCost) ||
    supplierUnitCost <= 0
  ) {
    return {
      suspect: false,
      ratio: null,
      normalizedRatio: null,
      packQty: 1,
      reason: "suspect check skipped — no usable Amazon price or supplier cost",
    };
  }

  // Confirmed pack: the caller's pack-normalization result wins. Only
  // when the caller supplied no packQty at all do we derive one from
  // the title — with the v2 parser, never a second implementation.
  let packQty = 1;
  if (
    typeof input.packQty === "number" &&
    Number.isInteger(input.packQty) &&
    input.packQty > 1 &&
    input.packConfidence !== "none"
  ) {
    packQty = input.packQty;
  } else if (
    (input.packQty === undefined || input.packQty === null) &&
    input.listingTitle !== undefined
  ) {
    const detected = detectListingPackQty(input.listingTitle);
    if (detected.packQty > 1) packQty = detected.packQty;
  }
  const packConfirmed = packQty > 1;

  const ratio = amazonPrice / supplierUnitCost;
  const normalizedRatio = ratio / packQty;
  const suspect = normalizedRatio > SUSPECT_RATIO_THRESHOLD;

  let reason: string;
  if (suspect && packConfirmed) {
    reason =
      `suspect_multipack: Amazon price $${amazonPrice.toFixed(2)} ÷ confirmed pack of ${packQty} ` +
      `is still ${fmtRatio(normalizedRatio)} the supplier unit cost $${supplierUnitCost.toFixed(2)} ` +
      `(threshold ${SUSPECT_RATIO_THRESHOLD}×) — the declared pack does not explain the spread; ` +
      `likely a larger undeclared case/pack mismatch, excluded from candidates until the pack basis is confirmed`;
  } else if (suspect) {
    reason =
      `suspect_multipack: Amazon price $${amazonPrice.toFixed(2)} is ${fmtRatio(ratio)} the supplier ` +
      `unit cost $${supplierUnitCost.toFixed(2)} with no confirmed pack declaration ` +
      `(threshold ${SUSPECT_RATIO_THRESHOLD}×) — likely an undeclared case/pack mismatch, ` +
      `excluded from candidates until the pack basis is confirmed`;
  } else if (packConfirmed && ratio > SUSPECT_RATIO_THRESHOLD) {
    reason =
      `suspect check: confirmed pack of ${packQty} explains the spread — normalized ratio ` +
      `${fmtRatio(normalizedRatio)} is within the ${SUSPECT_RATIO_THRESHOLD}× threshold, not suspect`;
  } else {
    reason =
      `suspect check: price/cost ratio ${fmtRatio(normalizedRatio)} is within the ` +
      `${SUSPECT_RATIO_THRESHOLD}× threshold, not suspect`;
  }

  return {
    suspect,
    ratio: round2(ratio),
    normalizedRatio: round2(normalizedRatio),
    packQty,
    reason,
  };
}
