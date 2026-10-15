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
import { floorPrice, outcomeAtPrice, referralPctForCategory } from "../engine/pricing.ts";

// --- Lifecycle ---------------------------------------------------------------

export type AlibabaOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "ready_to_place"
  | "awaiting_payment"
  | "placed"
  | "shipped"
  | "delivered"
  | "failed"
  | "cancelled";

// draft → pending_approval (intent created) → approved (intent approved)
// approved → ready_to_place (order APIs dark) or awaiting_payment (live:
//   the order exists on Alibaba, created-but-unpaid — payment is completed
//   by the founder at Alibaba's cashier via the stored pay_url)
// awaiting_payment → placed (pay result query confirms PAY_SUCCESS)
// placed → shipped → delivered; failure/cancellation recorded, never hidden.
const ORDER_TRANSITIONS: Record<AlibabaOrderStatus, AlibabaOrderStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled", "draft"],
  approved: ["ready_to_place", "awaiting_payment", "placed", "failed", "cancelled"],
  ready_to_place: ["awaiting_payment", "placed", "failed", "cancelled"],
  awaiting_payment: ["placed", "shipped", "delivered", "failed", "cancelled"],
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
 * The order API method names were verified in Alibaba's console for this
 * app on 2026-10-15 (/order/freight/calculate, /buynow/order/create,
 * /alibaba/order/pay/result/query — see lib/alibaba/orders.ts). Ordering
 * still stays dark until the founder flips this on. Default OFF.
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

// --- Import-intent economics verdict -------------------------------------------

export interface DraftEconomics {
  verdict: "BUY" | "SKIP" | "UNKNOWN";
  reasons: string[];
  floorPrice: number;
  netProfitPerUnit: number;
  marginPct: number; // percent, at the expected sell price
}

/**
 * Verdict for an Alibaba import draft, computed from the DRAFT's own
 * economics — the same fee-stack math (lib/engine/pricing) and the same
 * 20% target margin evaluateDeal applies to retail deals.
 *
 * The retail verdict's velocity leg is deliberately absent here: the
 * imported product has no listing of ours yet, so there is no BSR or
 * sell-through signal for OUR listing, and a benchmark ASIN's velocity
 * measures the benchmark brand's demand, not ours. (Feeding evaluateDeal
 * no velocity signal makes it answer UNKNOWN for every import, however
 * profitable.) Sell-through risk on imports is carried instead by the
 * guardrail dollar caps and the founder's approval of the intent.
 */
export function evaluateDraftEconomics(input: {
  landedPerUnit: number;
  expectedSellPrice: number | null | undefined;
  category?: string;
  targetMarginPct?: number;
}): DraftEconomics {
  const targetMargin = input.targetMarginPct ?? 0.2;
  const sell = input.expectedSellPrice ?? NaN;
  if (!(input.landedPerUnit > 0) || !(sell > 0)) {
    return {
      verdict: "UNKNOWN",
      reasons: ["Missing landed cost / expected sell price — cannot evaluate."],
      floorPrice: 0,
      netProfitPerUnit: 0,
      marginPct: 0,
    };
  }
  const costs = {
    buyCost: input.landedPerUnit,
    referralPct: referralPctForCategory(input.category),
  };
  const floor = floorPrice(costs, targetMargin);
  const outcome = outcomeAtPrice(sell, costs);
  const reasons: string[] = [];
  let verdict: DraftEconomics["verdict"];
  if (sell >= floor) {
    verdict = "BUY";
    reasons.push(
      `Net $${outcome.netProfit.toFixed(2)}/unit at expected sell $${sell.toFixed(2)} (${(outcome.marginPct * 100).toFixed(1)}% margin) clears the $${floor.toFixed(2)} floor at ${(targetMargin * 100).toFixed(0)}% target margin.`
    );
  } else {
    verdict = "SKIP";
    reasons.push(
      `Expected sell $${sell.toFixed(2)} is below floor $${floor.toFixed(2)} at ${(targetMargin * 100).toFixed(0)}% target margin.`
    );
  }
  return {
    verdict,
    reasons,
    floorPrice: Math.round(floor * 100) / 100,
    netProfitPerUnit: Math.round(outcome.netProfit * 100) / 100,
    marginPct: Math.round(outcome.marginPct * 1000) / 10,
  };
}

// --- Placement gate ------------------------------------------------------------------

export type IntentStatusForOrder = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXECUTED" | null;

export interface PlaceDecision {
  allowed: boolean;
  /** Where an allowed placement lands: live → `awaiting_payment` (the
   * order is created on Alibaba but UNPAID — there is no headless API
   * payment; the founder pays at Alibaba's cashier via the pay_url), or
   * the honest ready_to_place holding state while the flag is off. */
  outcome: "awaiting_payment" | "ready_to_place" | null;
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
  return { allowed: true, outcome: input.ordersLive ? "awaiting_payment" : "ready_to_place", reasons: [] };
}

// --- Placement payloads (console-verified API shapes, 2026-10-15) ----------------------
//
// The order APIs document FLAT business params (unlike search's `param0`
// and description's `query_req` wrappers): /order/freight/calculate takes
// e_company_id + destination_country + logistics_product_list;
// /buynow/order/create takes channel_refer_id + logistics_detail +
// product_list and returns value.trade_id + value.pay_url. Payment is
// completed by the buyer in a browser at that pay_url — the dropshipping
// pay API only hands back the cashier URL — so placement ENDS at
// created-unpaid (`awaiting_payment`) and /alibaba/order/pay/result/query
// is how sync learns the outcome. Builders/parsers are pure so the
// harness pins every shape.

function asRec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function asNum(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Alibaba ids travel as JSON numbers when the id is fully numeric. */
function productIdValue(productId: string): number | string {
  return /^\d+$/.test(productId) ? Number(productId) : productId;
}

/** First record, among the usual IOP nesting spots, that carries one of
 * `keys` — response envelopes vary (result/value/data), values don't. */
function findRecordWith(raw: unknown, keys: string[]): Record<string, unknown> | null {
  const root = asRec(raw);
  if (!root) return null;
  const result = asRec(root.result);
  const data = asRec(root.data);
  const candidates: Array<Record<string, unknown> | null> = [
    root,
    asRec(root.value),
    result,
    result ? asRec(result.value) : null,
    result ? asRec(result.result_data) : null,
    data,
    data ? asRec(data.value) : null,
  ];
  for (const c of candidates) {
    if (c && keys.some((k) => c[k] !== undefined && c[k] !== null)) return c;
  }
  return null;
}

/** First array among the usual IOP nesting spots (freight returns value[]). */
function findArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  const root = asRec(raw);
  if (!root) return null;
  const result = asRec(root.result);
  const data = asRec(root.data);
  const candidates: unknown[] = [
    root.value,
    root.result,
    root.data,
    result?.value,
    result?.result_data,
    data?.value,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return null;
}

export interface FreightRequest {
  e_company_id: string;
  destination_country: string;
  logistics_product_list: Array<Record<string, unknown>>;
}

/** Body for /order/freight/calculate ("Advanced Freight Cost Calculation"). */
export function buildFreightRequest(input: {
  eCompanyId: string;
  productId: string;
  skuId: string | null;
  qty: number;
}): FreightRequest {
  const line: Record<string, unknown> = { product_id: productIdValue(input.productId) };
  if (input.skuId) line.sku_id = input.skuId;
  line.quantity = input.qty;
  return {
    e_company_id: input.eCompanyId,
    destination_country: "US",
    logistics_product_list: [line],
  };
}

export interface FreightSolution {
  /** vendor_code — becomes logistics_detail.carrier_code at create. */
  carrierCode: string;
  freightFee: number;
  currency: string | null;
  deliveryTime: string | null;
  vendorName: string | null;
  raw: unknown;
}

/** Cheapest usable solution from a freight response; null when the
 * response carries no solution with a vendor_code and a numeric fee. */
export function pickFreightSolution(rawResponse: unknown): FreightSolution | null {
  const list = findArray(rawResponse);
  if (!list) return null;
  let best: FreightSolution | null = null;
  for (const entry of list) {
    const rec = asRec(entry);
    if (!rec) continue;
    const carrierCode = asStr(rec.vendor_code ?? rec.vendorCode);
    const fee = asRec(rec.fee);
    const amount = asNum(fee?.amount ?? rec.fee_amount ?? rec.amount);
    if (!carrierCode || amount === null || amount < 0) continue;
    const solution: FreightSolution = {
      carrierCode,
      freightFee: Math.round(amount * 100) / 100,
      currency: (fee ? asStr(fee.currency) : "") || asStr(rec.currency) || null,
      deliveryTime: asStr(rec.delivery_time ?? rec.deliveryTime) || null,
      vendorName: asStr(rec.vendor_name ?? rec.vendorName) || null,
      raw: entry,
    };
    if (!best || solution.freightFee < best.freightFee) best = solution;
  }
  return best;
}

export interface FreightGuardResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * The real freight quote may not silently reprice an approved order:
 * product (recomputed) + freight must stay within +10% of the total the
 * founder approved AND within the per-order guardrail cap (supplied by
 * the caller from lib/engine/guards capsFromEnv — never hardcoded here).
 */
export function freightGuard(input: {
  productTotal: number;
  freightFee: number;
  approvedTotal: number;
  perOrderCap: number;
}): FreightGuardResult {
  const reasons: string[] = [];
  const total = Math.round((input.productTotal + input.freightFee) * 100) / 100;
  const approvalLimit = Math.round(input.approvedTotal * 1.1 * 100) / 100;
  if (total > approvalLimit) {
    reasons.push(
      `Product $${input.productTotal.toFixed(2)} + freight $${input.freightFee.toFixed(2)} = $${total.toFixed(2)} exceeds the approved total $${input.approvedTotal.toFixed(2)} by more than 10% (limit $${approvalLimit.toFixed(2)}).`
    );
  }
  if (total > input.perOrderCap) {
    reasons.push(
      `Product $${input.productTotal.toFixed(2)} + freight $${input.freightFee.toFixed(2)} = $${total.toFixed(2)} exceeds the per-order cap of $${input.perOrderCap.toFixed(2)}.`
    );
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Five S's import receiving address — the Automated 3PL warehouse that
 * is already the FBA ship-from in Seller Central. */
export const IMPORT_SHIP_TO = {
  address: "120 Tolland Street, Unit D",
  city: "East Hartford",
  contact_person: "Radu Daha",
  country: "United States",
  country_code: "US",
  zip: "06108",
} as const;

export interface CreateOrderRequest {
  channel_refer_id: string;
  logistics_detail: {
    carrier_code: string;
    dispatch_location: string;
    shipment_address: typeof IMPORT_SHIP_TO;
  };
  product_list: Array<Record<string, unknown>>;
}

/** Body for /buynow/order/create. channel_refer_id is OUR order ref —
 * Alibaba echoes it back, which is how a created order reconciles. */
export function buildCreateRequest(input: {
  ref: string;
  carrierCode: string;
  productId: string;
  skuId: string | null;
  qty: number;
}): CreateOrderRequest {
  const line: Record<string, unknown> = { product_id: productIdValue(input.productId) };
  line.quantity = input.qty;
  if (input.skuId) line.sku_id = input.skuId;
  return {
    channel_refer_id: input.ref,
    logistics_detail: {
      carrier_code: input.carrierCode,
      dispatch_location: "CN",
      shipment_address: IMPORT_SHIP_TO,
    },
    product_list: [line],
  };
}

/** value.trade_id (Alibaba order number) + value.pay_url from a create
 * response; both null when absent (a create without a trade_id is NOT an
 * order — the caller treats it as not created). */
export function parseCreateResponse(raw: unknown): { tradeId: string | null; payUrl: string | null } {
  const rec = findRecordWith(raw, ["trade_id", "tradeId", "pay_url", "payUrl"]);
  if (!rec) return { tradeId: null, payUrl: null };
  const tid = rec.trade_id ?? rec.tradeId;
  return {
    tradeId: tid !== undefined && tid !== null && asStr(tid) ? asStr(tid) : null,
    payUrl: asStr(rec.pay_url ?? rec.payUrl) || null,
  };
}

/** /alibaba/order/pay/result/query response: paid only on PAY_SUCCESS. */
export function parsePayResult(raw: unknown): {
  status: string | null;
  paid: boolean;
  payUrl: string | null;
} {
  const rec = findRecordWith(raw, ["status", "pay_url", "payUrl"]);
  if (!rec) return { status: null, paid: false, payUrl: null };
  const status = asStr(rec.status) || null;
  return {
    status,
    paid: status === "PAY_SUCCESS",
    payUrl: asStr(rec.pay_url ?? rec.payUrl) || null,
  };
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
