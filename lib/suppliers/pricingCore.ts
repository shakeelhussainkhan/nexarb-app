// Pure pricing-pass policy for supplier offers (shared by every supplier
// adapter through lib/suppliers/offers.ts). No I/O — the offline harness
// (scripts/verify-pricing-selection.mjs) drives this file directly.
//
// Why this exists — the livelock it fixes: the pricing pass used to select
// matched-but-unpriced offers oldest-first (first_seen_at) and, when the
// SP-API lookup returned no competitive price, wrote NOTHING. The same
// no-price offers were therefore re-selected at the head of the queue on
// every call: processed=100 / priced +0 / skipped=100 forever, and the
// Frontier drain (8,436 matched offers, priced stuck at ~330) never
// advanced past the first no-price block.
//
// The policy below bounds that: every no-price attempt is persisted
// (price_attempts / price_attempted_at, migration 024), an offer is due
// for another attempt only after a spacing gap, and after a bounded
// number of attempts it leaves the rotation entirely. Selection is
// least-recently-attempted first, so fresh offers are always attempted
// before any retry — forward progress is guaranteed, and a call finds
// nothing due (processed = 0, the drain's stop signal) only when every
// unpriced offer is priced, attempt-capped, or inside its spacing gap.

/** Default offers attempted per scan call. Each attempt costs two
 *  throttled SP-API calls (LWA token exchange + competitive pricing) at
 *  a 1s minimum interval, so a call's pacing floor is ~2s per offer:
 *  25 offers ≈ 50s+ of pacing — comfortably inside the callers' time
 *  budget, where the old default of 100 (a ~200s floor before latency
 *  or retries) timed out with empty responses. */
export const PRICE_SCAN_DEFAULT_CAP = 25;

/** Hard ceiling for a caller-supplied cap, enforced in the lib. */
export const PRICE_SCAN_MAX_CAP = 50;

/** Candidate rows fetched per call, as a multiple of the cap. The fetch
 *  is ordered least-recently-attempted first, so the window always holds
 *  the most-due rows; the picker below applies the due rules exactly. */
export const PRICE_SCAN_OVERSAMPLE = 4;

/** An offer leaves the pricing rotation after this many no-price
 *  attempts. Its row keeps amazon_price NULL and priced_at NULL — it is
 *  counted as exhausted in the scan result, never silently dropped. */
export const PRICE_ATTEMPT_MAX = 3;

/** Minimum gap between two attempts of the same offer, so one bad day
 *  (e.g. an SP-API outage, where every lookup returns no price) can cost
 *  an offer at most one attempt. */
export const PRICE_ATTEMPT_SPACING_MS = 24 * 60 * 60 * 1000;

export interface PricingAttemptState {
  priceAttempts: number;
  priceAttemptedAt: string | null;
}

/**
 * True when an unpriced offer may be attempted now: never attempted, or
 * its attempt budget is not exhausted and its last attempt is at least
 * the spacing gap ago. An unparseable timestamp is treated as due —
 * retrying is the honest failure mode for a corrupt stamp.
 */
export function pricingAttemptDue(
  state: PricingAttemptState,
  nowMs: number,
  spacingMs: number = PRICE_ATTEMPT_SPACING_MS,
  maxAttempts: number = PRICE_ATTEMPT_MAX
): boolean {
  if (state.priceAttempts >= maxAttempts) return false;
  if (!state.priceAttemptedAt) return true;
  const t = Date.parse(state.priceAttemptedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= spacingMs;
}

/** True when the offer has used up its no-price attempt budget. */
export function pricingAttemptExhausted(
  state: PricingAttemptState,
  maxAttempts: number = PRICE_ATTEMPT_MAX
): boolean {
  return state.priceAttempts >= maxAttempts;
}

/**
 * Pick the next batch from candidate rows PRE-SORTED
 * least-recently-attempted first (never-attempted first). Rows inside
 * their spacing gap are skipped — the batch is filled from later due
 * rows, which is exactly the advancement the old first_seen_at queue
 * lacked. Returns at most `cap` rows, preserving input order.
 */
export function pickPricingBatch<T extends PricingAttemptState>(
  rows: readonly T[],
  cap: number,
  nowMs: number,
  spacingMs: number = PRICE_ATTEMPT_SPACING_MS,
  maxAttempts: number = PRICE_ATTEMPT_MAX
): T[] {
  const out: T[] = [];
  const limit = Math.max(0, Math.trunc(cap));
  for (const row of rows) {
    if (out.length >= limit) break;
    if (pricingAttemptDue(row, nowMs, spacingMs, maxAttempts)) out.push(row);
  }
  return out;
}
