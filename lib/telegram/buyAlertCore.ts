// Pure decision core for Telegram BUY-signal alerts: eligibility gating
// labels + repeat-alert dedupe. No I/O — lib/telegram/alerts.ts reads the
// persisted state (migration 026 columns on watchlist + deal_checks
// history), asks this module, and records the new state after a send.
//
// Why dedupe exists: the watchlist scan runs several times a day and used
// to re-alert every BUY verdict verbatim — the identical alerts for
// B0DT4W7FP3 / B0D2HZBRJL fired at 08:58 and 20:58 on 2026-10-16, and
// B0D2HZBRJL again at 08:58 on 2026-10-17. A repeat alert is only worth
// sending when the signal actually changed.

/** Snapshot of one BUY signal, as persisted after an alert or observed now. */
export interface BuyAlertSnapshot {
  verdict: string;
  /** Sell price the verdict was computed at (verdict.realisticPrice). */
  sellPrice: number;
  /** Eligibility state at the time ("SELLABLE", "APPROVAL_REQUIRED", ...). */
  eligibility: string;
}

export type BuyAlertReason =
  | "new-buy"
  | "re-entry"
  | "eligibility-change"
  | "price-move"
  | "unchanged"
  | "not-buy";

export interface BuyAlertDecision {
  shouldAlert: boolean;
  reason: BuyAlertReason;
}

/** A sell-price move counts as material only when BOTH thresholds clear:
 * a 6% wiggle on a $4 item ($0.24) is noise; $0.60 on a $40 item (1.5%)
 * is noise too. */
export const MATERIAL_PRICE_MOVE_PCT = 5;
export const MATERIAL_PRICE_MOVE_MIN_USD = 0.5;

export function isMaterialPriceMove(previous: number, next: number): boolean {
  const delta = Math.abs(next - previous);
  if (delta < MATERIAL_PRICE_MOVE_MIN_USD) return false;
  if (previous <= 0) return delta > 0;
  return (delta / previous) * 100 >= MATERIAL_PRICE_MOVE_PCT;
}

/**
 * Decide whether a BUY trace should produce a Telegram alert.
 * - lastAlerted: the snapshot recorded when the last BUY alert for this
 *   ASIN was actually delivered (null = never alerted, or state unreadable
 *   — infra failures degrade to "alert as before", never to suppression).
 * - previousVerdict: the verdict of the previous persisted deal check for
 *   this ASIN (null when unknown). A non-BUY previous verdict means the
 *   signal left BUY and has now re-entered — a fresh event even at an
 *   unchanged price.
 */
export function decideBuyAlert(input: {
  lastAlerted: BuyAlertSnapshot | null;
  previousVerdict: string | null;
  current: BuyAlertSnapshot;
}): BuyAlertDecision {
  const { lastAlerted, previousVerdict, current } = input;
  if (current.verdict !== "BUY") return { shouldAlert: false, reason: "not-buy" };
  if (lastAlerted === null) return { shouldAlert: true, reason: "new-buy" };
  if (previousVerdict !== null && previousVerdict !== "BUY") {
    return { shouldAlert: true, reason: "re-entry" };
  }
  if (lastAlerted.eligibility !== current.eligibility) {
    return { shouldAlert: true, reason: "eligibility-change" };
  }
  if (isMaterialPriceMove(lastAlerted.sellPrice, current.sellPrice)) {
    return { shouldAlert: true, reason: "price-move" };
  }
  return { shouldAlert: false, reason: "unchanged" };
}

/** Header label for a gated eligibility state, or null when the deal is
 * cleanly sellable. Any non-SELLABLE state gates the alert: APPROVAL_REQUIRED
 * is the known brand-gate; BLOCKED / UNKNOWN must never be presented as a
 * plain BUY either. */
export function eligibilityGateLabel(state: string): string | null {
  switch (state) {
    case "SELLABLE":
      return null;
    case "APPROVAL_REQUIRED":
      return "APPROVAL REQUIRED (brand-gated)";
    case "BLOCKED":
      return "BLOCKED — NOT ELIGIBLE TO LIST";
    case "UNKNOWN":
      return "ELIGIBILITY UNCONFIRMED";
    default:
      return `ELIGIBILITY ${state}`;
  }
}

export function isGatedEligibility(state: string): boolean {
  return eligibilityGateLabel(state) !== null;
}
