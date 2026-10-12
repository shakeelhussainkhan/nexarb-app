// Assisted-checkout state machine (migration 008).
//
// Lifecycle: the browser-assisted checkout prepares the retail cart and
// STOPS at the payment step. It NEVER enters card details and NEVER completes
// payment. These helpers are pure (no network, no secrets) so they can be
// unit-tested offline.

/** Checkout lifecycle states (matches the DB CHECK constraint). */
export const CHECKOUT_STATUSES = [
  "none",
  "requested",
  "in_progress",
  "awaiting_payment",
  "completed",
  "failed",
] as const;

export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** Legal forward transitions for the `status` action. */
const LEGAL_TRANSITIONS: Record<CheckoutStatus, CheckoutStatus[]> = {
  none: ["requested"],
  requested: ["in_progress", "failed"],
  in_progress: ["awaiting_payment", "failed"],
  awaiting_payment: ["completed", "failed"],
  failed: ["requested"], // retry after a failure
  completed: [], // terminal
};

export function isCheckoutStatus(v: unknown): v is CheckoutStatus {
  return typeof v === "string" && (CHECKOUT_STATUSES as readonly string[]).includes(v);
}

/**
 * Validate a manual status update.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function validateCheckoutTransition(
  from: string | null | undefined,
  to: string
): { ok: true } | { ok: false; reason: string } {
  const current: CheckoutStatus = isCheckoutStatus(from) ? from : "none";
  if (!isCheckoutStatus(to)) {
    return { ok: false, reason: `Invalid checkout status "${to}".` };
  }
  if (current === to) return { ok: true };
  const allowed = LEGAL_TRANSITIONS[current];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Illegal checkout transition "${current}" → "${to}". Allowed: ${allowed.join(", ") || "none"}.`,
    };
  }
  return { ok: true };
}

/**
 * Validate a checkout `request` against the intent's purchase status and
 * current checkout state.
 * - The intent must be APPROVED (never PENDING_APPROVAL/REJECTED/EXECUTED).
 * - Current checkout_status must be "none" or "failed" (fresh request or retry).
 */
export function validateCheckoutRequest(
  purchaseStatus: string,
  checkoutStatus: string | null | undefined
): { ok: true } | { ok: false; reason: string } {
  if (purchaseStatus !== "APPROVED") {
    return {
      ok: false,
      reason: `Checkout can only be requested for APPROVED intents (current: ${purchaseStatus}).`,
    };
  }
  const current: CheckoutStatus = isCheckoutStatus(checkoutStatus) ? checkoutStatus : "none";
  if (current !== "none" && current !== "failed") {
    return {
      ok: false,
      reason: `Checkout already "${current}" — wait for it to finish or fail before requesting again.`,
    };
  }
  return { ok: true };
}
