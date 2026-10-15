// Alibaba order flow — pure core.
//
// The state machine and money math for turning a sourced Alibaba offer
// into an order. No network, no database: the API routes and the offline
// harness exercise every rule here. Network calls live in
// lib/alibaba/orders.ts; signing/transport in lib/alibaba/client.ts.
//
// HARD RULES encoded here (founder policy):
//  - A compliance-BLOCKED offer can never become an order.
//  - An order can only be placed when its linked purchase intent is
//    APPROVED. There is no code path from draft to placed that skips
//    the purchases pipeline (PENDING_APPROVAL + guardrail caps).
//  - Caps are NEVER read here — the intent route consumes them from
//    lib/engine/guards.ts (capsFromEnv) exactly like POST /api/purchases.

import type { LandedCost } from "./core";
import type { ScreeningResult } from "@/lib/compliance/core";

// --- Lifecycle ---------------------------------------------------------------

export type AlibabaOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "ready_to_place"
  | "placed"
  | "shipped"
  | "delivered"
  | "failed"
  | "cancelled";

// draft → pending_approval (intent created) → approved (intent approved)
// approved → ready_to_place (order APIs not live-verified yet) or placed
// ready_to_place → placed (once the order APIs are live)
// placed → shipped → delivered; failure/cancellation recorded, never hidden.
const ORDER_TRANSITIONS: Record<AlibabaOrderStatus, AlibabaOrderStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled", "draft"],
  approved: ["ready_to_place", "placed", "failed", "cancelled"],
  ready_to_place: ["placed", "failed", "cancelled"],
  placed: ["shipped", "delivered", "failed", "cancelled"],
  shipped: ["delivered", "failed"],
  delivered: [],
  failed: ["draft", "cancelled"],
  cancelled: [],
};

export function canTransitionOrder(from: AlibabaOrderStatus, to: AlibabaOrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function validNextOrderStatuses(from: AlibabaOrderStatus): AlibabaOrderStatus[] {
  return [...(ORDER_TRANSITIONS[from] ?? [])];
}

// --- Live flag -----------------------------------------------------------------

/**
 * Alibaba's order APIs are NOT live-verified (see lib/alibaba/orders.ts —
 * the method names come from the developer docs index, never from a real
 * response). Ordering stays dark until the founder flips this on AND the
 * endpoints have been verified against the live app. Default OFF.
 */
export function ordersLiveFromEnv(env: Record<string, string | undefined>): boolean {
  const raw = (env.ALIBABA_ORDERS_LIVE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// --- Screening gate --------------------------------------------------------------

/** Returns a refusal reason when compliance screening forbids an order. */
export function draftBlockReason(screening: ScreeningResult): string | null {
  if (screening.verdict === "blocked") {
    return `Compliance screening BLOCKED this product: ${screening.reasons[0] ?? "prohibited goods"}`;
  }
  return null;
}

// --- Money -----------------------------------------------------------------------

export interface OrderTotals {
  qty: number;
  unitPrice: number;
  shippingPerUnit: number;
  landedPerUnit: number;
  /** qty × landedPerUnit — the number the guardrail caps are checked against. */
  orderTotal: number;
}

/** Order totals from the SAME landed-cost math the sourcing route uses
 * (lib/alibaba/core bestLandedCost) — never a second pricing formula. */
export function totalsFromLanded(landed: LandedCost): OrderTotals {
  const orderTotal = Math.round(landed.orderQty * landed.landedPerUnit * 100) / 100;
  return {
    qty: landed.orderQty,
    unitPrice: landed.unitPrice,
    shippingPerUnit: landed.shippingPerUnit,
    landedPerUnit: landed.landedPerUnit,
    orderTotal,
  };
}

// --- Placement gate ------------------------------------------------------------------

export type IntentStatusForOrder = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXECUTED" | null;

export interface PlaceDecision {
  allowed: boolean;
  /** Where an allowed placement lands: a live API order, or the honest
   * ready_to_place holding state while the order APIs are unverified. */
  outcome: "placed" | "ready_to_place" | null;
  reasons: string[];
}

/**
 * The ONLY placement decision used by the place route. Placement requires:
 *  - the order itself is in `approved` (or `ready_to_place` on a retry), and
 *  - the linked purchase intent exists and is APPROVED.
 * Anything else refuses with the full list of blockers.
 */
export function evaluatePlacement(input: {
  orderStatus: AlibabaOrderStatus;
  intentStatus: IntentStatusForOrder;
  ordersLive: boolean;
}): PlaceDecision {
  const reasons: string[] = [];
  if (input.orderStatus !== "approved" && input.orderStatus !== "ready_to_place") {
    reasons.push(`Order is ${input.orderStatus} — placement requires an approved order.`);
  }
  if (!input.intentStatus) {
    reasons.push("No purchase intent is linked — create one first (draft → intent → founder approval).");
  } else if (input.intentStatus !== "APPROVED") {
    reasons.push(`Purchase intent is ${input.intentStatus} — placement requires APPROVED. Nothing is ordered without the founder's approval of the intent.`);
  }
  if (reasons.length > 0) return { allowed: false, outcome: null, reasons };
  return { allowed: true, outcome: input.ordersLive ? "placed" : "ready_to_place", reasons: [] };
}

// --- Status mapping from Alibaba payloads ----------------------------------------------

/** Map a raw Alibaba order-status string onto our lifecycle. Unknown values
 * never move the order — sync stores the raw payload and leaves status alone. */
export function mapAlibabaOrderStatus(raw: unknown): AlibabaOrderStatus | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  if (s.includes("deliver") || s.includes("complete") || s.includes("received")) return "delivered";
  if (s.includes("ship") || s.includes("transit") || s.includes("logistic")) return "shipped";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("fail") || s.includes("refund")) return "failed";
  if (s.includes("paid") || s.includes("created") || s.includes("placed") || s.includes("success")) return "placed";
  return null;
}

let refSeq = 0;
/** Human-facing NexArb order reference, e.g. AO-M8XYZ123-1. */
export function newAlibabaOrderRef(now: Date = new Date()): string {
  refSeq += 1;
  return `AO-${now.getTime().toString(36).toUpperCase()}-${refSeq.toString(36).toUpperCase()}`;
}
