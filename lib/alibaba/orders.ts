// Alibaba order flow — server module.
//
// Database access for alibaba_orders (migration 020), the compliance
// record creation that accompanies placement, status sync, and the
// Alibaba order API calls themselves.
//
// ORDER APIs — method names + parameter shapes verified in Alibaba's
// console for this app on 2026-10-15 (the docs-index freight path used
// before, /alibaba/dropshipping/freight/calculate, does not exist — the
// first live Place attempt failed on exactly that): freight is
// /order/freight/calculate, create is /buynow/order/create, and payment
// state is read from /alibaba/order/pay/result/query. There is NO
// headless API payment: create returns a cashier pay_url and the founder
// pays in a browser, so a live placement ends at `awaiting_payment`.
// Every call still sits behind the ALIBABA_ORDERS_LIVE env flag (default
// OFF, lib/alibaba/ordersCore.ts): with the flag off, an approved order
// moves to `ready_to_place` and NO order call is attempted. With the flag
// on, all order traffic goes through the single orderApiCall() below.

import { getSupabaseAdmin } from "@/lib/supabase";
import type { AlibabaConfig } from "./core";
import { callAlibabaApi, getAlibabaProduct, getValidAlibabaToken } from "./client";
import {
  buildCreateRequest,
  buildFreightRequest,
  buildSyncAttempt,
  freightGuard,
  lastSyncFromRaw,
  mapAlibabaOrderStatus,
  ordersLiveFromEnv,
  parseCreateResponse,
  parsePayResult,
  pickFreightSolution,
  type AlibabaOrderStatus,
  type AlibabaSyncAttempt,
} from "./ordersCore";
import {
  complianceChecklist,
  detectCategory,
  estimateDuties,
  type ScreeningResult,
} from "@/lib/compliance/core";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface AlibabaOrderRecord {
  id: string;
  userId: string;
  ref: string;
  alibabaOrderId: string | null;
  alibabaProductId: string;
  skuId: string | null;
  title: string;
  imageUrl: string | null;
  detailUrl: string | null;
  supplierName: string | null;
  targetAsin: string | null;
  expectedSellPrice: number | null;
  qty: number;
  unitPrice: number;
  shippingPerUnit: number;
  landedPerUnit: number;
  orderTotal: number;
  currency: string;
  moq: number | null;
  offerSnapshot: Record<string, unknown>;
  screeningVerdict: string;
  screeningReasons: string[];
  screeningCategory: string | null;
  status: AlibabaOrderStatus;
  purchaseIntentId: string | null;
  shipmentId: string | null;
  productComplianceId: string | null;
  alibabaStatusRaw: unknown;
  /** Alibaba cashier URL for a created-but-unpaid order, derived from
   * alibaba_status_raw (no separate column — the raw payload is the
   * source of truth). Null unless the order is awaiting payment. */
  payUrl: string | null;
  /** The most recent status-sync attempt, derived from
   * alibaba_status_raw.lastSync (same no-separate-column pattern as
   * payUrl). Null until a sync has run against this order. */
  lastSync: AlibabaSyncAttempt | null;
  placedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function payUrlFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).payUrl;
  return typeof v === "string" && v ? v : null;
}

function rowToOrder(row: Record<string, unknown>): AlibabaOrderRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    ref: String(row.ref),
    alibabaOrderId: row.alibaba_order_id ? String(row.alibaba_order_id) : null,
    alibabaProductId: String(row.alibaba_product_id),
    skuId: row.sku_id ? String(row.sku_id) : null,
    title: String(row.title),
    imageUrl: row.image_url ? String(row.image_url) : null,
    detailUrl: row.detail_url ? String(row.detail_url) : null,
    supplierName: row.supplier_name ? String(row.supplier_name) : null,
    targetAsin: row.target_asin ? String(row.target_asin) : null,
    expectedSellPrice: row.expected_sell_price != null ? Number(row.expected_sell_price) : null,
    qty: Number(row.qty),
    unitPrice: Number(row.unit_price),
    shippingPerUnit: Number(row.shipping_per_unit),
    landedPerUnit: Number(row.landed_per_unit),
    orderTotal: Number(row.order_total),
    currency: String(row.currency ?? "USD"),
    moq: row.moq != null ? Number(row.moq) : null,
    offerSnapshot: (row.offer_snapshot as Record<string, unknown>) ?? {},
    screeningVerdict: String(row.screening_verdict),
    screeningReasons: Array.isArray(row.screening_reasons) ? (row.screening_reasons as string[]) : [],
    screeningCategory: row.screening_category ? String(row.screening_category) : null,
    status: row.status as AlibabaOrderStatus,
    purchaseIntentId: row.purchase_intent_id ? String(row.purchase_intent_id) : null,
    shipmentId: row.shipment_id ? String(row.shipment_id) : null,
    productComplianceId: row.product_compliance_id ? String(row.product_compliance_id) : null,
    alibabaStatusRaw: row.alibaba_status_raw ?? null,
    payUrl: payUrlFromRaw(row.alibaba_status_raw),
    lastSync: lastSyncFromRaw(row.alibaba_status_raw),
    placedAt: row.placed_at ? String(row.placed_at) : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function insertOrder(
  admin: Admin,
  input: {
    userId: string;
    ref: string;
    alibabaProductId: string;
    skuId: string | null;
    title: string;
    imageUrl: string | null;
    detailUrl: string | null;
    supplierName: string | null;
    targetAsin: string | null;
    expectedSellPrice: number | null;
    totals: { qty: number; unitPrice: number; shippingPerUnit: number; landedPerUnit: number; orderTotal: number };
    currency: string;
    moq: number | null;
    offerSnapshot: Record<string, unknown>;
    screening: ScreeningResult;
    /** Real freight quoted at draft time — persisted into
     * alibaba_status_raw as { freightQuote } so the approval carries
     * the quote the totals were built from. */
    freightQuote?: DraftFreightQuote | null;
  }
): Promise<{ ok: boolean; order?: AlibabaOrderRecord; error?: string }> {
  const { data, error } = await admin
    .from("alibaba_orders")
    .insert({
      user_id: input.userId,
      ref: input.ref,
      alibaba_product_id: input.alibabaProductId,
      sku_id: input.skuId,
      title: input.title,
      image_url: input.imageUrl,
      detail_url: input.detailUrl,
      supplier_name: input.supplierName,
      target_asin: input.targetAsin,
      expected_sell_price: input.expectedSellPrice,
      qty: input.totals.qty,
      unit_price: input.totals.unitPrice,
      shipping_per_unit: input.totals.shippingPerUnit,
      landed_per_unit: input.totals.landedPerUnit,
      order_total: input.totals.orderTotal,
      currency: input.currency,
      moq: input.moq,
      offer_snapshot: input.offerSnapshot,
      ...(input.freightQuote ? { alibaba_status_raw: { freightQuote: input.freightQuote } } : {}),
      screening_verdict: input.screening.verdict,
      screening_reasons: input.screening.reasons,
      screening_category: input.screening.category,
      status: "draft",
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
  return { ok: true, order: rowToOrder(data as Record<string, unknown>) };
}

export async function getOrder(admin: Admin, userId: string, id: string): Promise<AlibabaOrderRecord | null> {
  const { data, error } = await admin
    .from("alibaba_orders")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToOrder(data as Record<string, unknown>);
}

export async function listOrders(admin: Admin, userId: string, limit = 100): Promise<AlibabaOrderRecord[]> {
  const { data, error } = await admin
    .from("alibaba_orders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(rowToOrder);
}

export async function updateOrder(
  admin: Admin,
  userId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<AlibabaOrderRecord | null> {
  const { data, error } = await admin
    .from("alibaba_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) return null;
  return rowToOrder(data as Record<string, unknown>);
}

/**
 * Reflect the linked intent's decision onto the order: an intent approved
 * in the Purchases UI moves a pending_approval order to `approved`; a
 * rejected intent cancels it. Called lazily on reads — the place route
 * always re-checks the intent itself, so this is display state only.
 */
export async function reconcileIntentState(
  admin: Admin,
  userId: string,
  order: AlibabaOrderRecord
): Promise<AlibabaOrderRecord> {
  if (!order.purchaseIntentId) return order;
  if (order.status !== "pending_approval" && order.status !== "approved") return order;
  const { data } = await admin
    .from("purchases")
    .select("status")
    .eq("id", order.purchaseIntentId)
    .maybeSingle();
  const intentStatus = data ? String((data as { status: string }).status) : null;
  if (intentStatus === "APPROVED" && order.status === "pending_approval") {
    return (await updateOrder(admin, userId, order.id, { status: "approved" })) ?? order;
  }
  if (intentStatus === "REJECTED") {
    return (await updateOrder(admin, userId, order.id, { status: "cancelled" })) ?? order;
  }
  return order;
}

// --- Compliance records -------------------------------------------------------

/**
 * Create the compliance records that accompany an order: a
 * product_compliance row carrying the category checklist, and an
 * import_shipments row with a duty estimate — linked both ways
 * (alibaba_orders.shipment_id / product_compliance_id and
 * import_shipments.alibaba_order_id). Idempotent: existing links win.
 */
export async function ensureComplianceRecords(
  admin: Admin,
  userId: string,
  order: AlibabaOrderRecord
): Promise<{ shipmentId: string | null; productComplianceId: string | null; errors: string[] }> {
  const errors: string[] = [];
  let { shipmentId, productComplianceId } = order;

  if (!productComplianceId) {
    const category = order.screeningCategory ?? detectCategory(order.title);
    const checklistStatus: Record<string, string> = {};
    for (const item of complianceChecklist(detectCategory(order.title))) {
      checklistStatus[item.key] = "needed";
    }
    const { data, error } = await admin
      .from("product_compliance")
      .insert({
        user_id: userId,
        asin: order.targetAsin,
        alibaba_product_id: order.alibabaProductId,
        title: order.title,
        supplier_name: order.supplierName,
        category,
        origin_country: "CN",
        screening_verdict: order.screeningVerdict,
        screening_reasons: order.screeningReasons,
        checklist_status: checklistStatus,
      })
      .select("id")
      .single();
    if (error || !data) errors.push(`product_compliance insert failed: ${error?.message ?? "unknown"}`);
    else productComplianceId = String((data as { id: string }).id);
  }

  if (!shipmentId) {
    const customsValue = Math.round(order.qty * order.unitPrice * 100) / 100;
    const dutyEstimate = estimateDuties({
      customsValue,
      originCountry: "CN",
      mfnRate: 0,
      section232: null,
      adcvdRate: 0,
      ocean: true,
    });
    const { data, error } = await admin
      .from("import_shipments")
      .insert({
        user_id: userId,
        name: `Alibaba ${order.ref} — ${order.title}`.slice(0, 200),
        supplier_name: order.supplierName,
        origin_country: "CN",
        transport: "ocean",
        status: "planning",
        customs_value: customsValue,
        duty_estimate: dutyEstimate,
        isf_data: {},
        notes: `Auto-created from Alibaba order ${order.ref} (NexArb). Alibaba order id: ${order.alibabaOrderId ?? "not placed yet"}.`,
        alibaba_order_id: order.id,
      })
      .select("id")
      .single();
    if (error || !data) errors.push(`import_shipments insert failed: ${error?.message ?? "unknown"}`);
    else shipmentId = String((data as { id: string }).id);
  }

  if (shipmentId !== order.shipmentId || productComplianceId !== order.productComplianceId) {
    await updateOrder(admin, userId, order.id, {
      shipment_id: shipmentId,
      product_compliance_id: productComplianceId,
    });
  }
  return { shipmentId, productComplianceId, errors };
}

// --- Alibaba order API calls (console-verified 2026-10-15 — flag-gated) ---------

const ORDER_METHODS = {
  // "Advanced Freight Cost Calculation" — the docs-index path used before
  // (/alibaba/dropshipping/freight/calculate) does not exist.
  freightCalculate: "/order/freight/calculate",
  create: "/buynow/order/create",
  // Payment is completed by the buyer at Alibaba's cashier (create returns
  // a pay_url); this query is how sync learns the payment outcome.
  payResultQuery: "/alibaba/order/pay/result/query",
  get: "/alibaba/order/get",
  list: "/alibaba/order/list",
  cancel: "/alibaba/order/cancel",
} as const;

/**
 * THE single place every Alibaba order call goes through. The order APIs
 * document FLAT business params — each payload key travels as its own
 * parameter, with object/array values JSON-stringified — unlike the
 * sourcing APIs (search wraps in `param0`, description in `query_req`).
 * Flat is the documented shape for these APIs; the first live calls
 * confirm it, and any fix lands here alone.
 */
async function orderApiCall(
  cfg: AlibabaConfig,
  accessToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    params[key] =
      typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return callAlibabaApi(cfg, accessToken, method, params, "POST");
}

/** A real freight quote captured at DRAFT time (see quoteDraftFreight) —
 * persisted on the draft so the founder's approval is against true
 * totals, and placement's re-quote can be compared against it by the
 * freight guard. */
export interface DraftFreightQuote {
  freightFee: number;
  /** vendor_code of the chosen (cheapest) solution — the carrier_code
   * placement will request at create. */
  carrierCode: string;
  deliveryTime: string | null;
  tradeTerm: string | null;
  quotedAt: string;
}

/**
 * Quote REAL door-to-door freight for a would-be draft via
 * /order/freight/calculate. Draft creation FAILS when no quote can be
 * produced — there is deliberately no fallback to the product
 * description's nominal shipping figure: that figure is not a freight
 * price (live proof, 2026-10-15: $10.50 nominal vs $388.11 real on the
 * same 350 units), and a draft built on it asks the founder to approve
 * a total that placement will then refuse.
 */
export async function quoteDraftFreight(
  cfg: AlibabaConfig,
  accessToken: string,
  input: { eCompanyId: string | null; productId: string; skuId: string | null; qty: number }
): Promise<{ ok: boolean; quote?: DraftFreightQuote; error?: string }> {
  if (!input.eCompanyId) {
    return {
      ok: false,
      error: "could not quote freight: supplier company id (e_company_id) unavailable from product description",
    };
  }
  const res = await orderApiCall(cfg, accessToken, ORDER_METHODS.freightCalculate, {
    ...buildFreightRequest({
      eCompanyId: input.eCompanyId,
      productId: input.productId,
      skuId: input.skuId,
      qty: input.qty,
    }),
  });
  if (!res.ok) return { ok: false, error: `could not quote freight: ${res.error}` };
  const solution = pickFreightSolution(res.data);
  if (!solution) {
    return { ok: false, error: "could not quote freight: freight calculate returned no usable shipping solution" };
  }
  const rawRec =
    solution.raw && typeof solution.raw === "object" && !Array.isArray(solution.raw)
      ? (solution.raw as Record<string, unknown>)
      : {};
  const tradeTerm = rawRec.trade_term ?? rawRec.tradeTerm;
  return {
    ok: true,
    quote: {
      freightFee: solution.freightFee,
      carrierCode: solution.carrierCode,
      deliveryTime: solution.deliveryTime,
      tradeTerm: typeof tradeTerm === "string" && tradeTerm ? tradeTerm : null,
      quotedAt: new Date().toISOString(),
    },
  };
}

export interface PlaceResult {
  ok: boolean;
  alibabaOrderId?: string;
  /** Cashier URL from the create response — the founder pays there. */
  payUrl?: string;
  freightFee?: number;
  carrierCode?: string;
  raw?: unknown;
  error?: string;
}

/**
 * Freight quote → price guard → create. Ends at created-but-UNPAID: the
 * create response's pay_url is returned for the founder to pay at
 * Alibaba's cashier (no headless payment exists). Stops at the first
 * failure and reports which step failed; nothing is created before the
 * freight guard passes, so an order is never repriced silently.
 */
export async function placeAlibabaOrder(
  cfg: AlibabaConfig,
  accessToken: string,
  order: AlibabaOrderRecord,
  perOrderCap: number
): Promise<PlaceResult> {
  // The freight API needs the supplier's (encrypted) company id, which
  // only the product description carries — fetch it live.
  const detailRes = await getAlibabaProduct(cfg, accessToken, order.alibabaProductId);
  if (!detailRes.ok || !detailRes.detail) {
    return { ok: false, error: `product description fetch failed: ${detailRes.error ?? "unknown error"}`, raw: detailRes.raw };
  }
  const eCompanyId = detailRes.detail.eCompanyId;
  if (!eCompanyId) {
    return { ok: false, error: "supplier company id (e_company_id) unavailable from product description", raw: detailRes.raw };
  }

  const freight = await orderApiCall(cfg, accessToken, ORDER_METHODS.freightCalculate, {
    ...buildFreightRequest({ eCompanyId, productId: order.alibabaProductId, skuId: order.skuId, qty: order.qty }),
  });
  if (!freight.ok) return { ok: false, error: `freight calculate failed: ${freight.error}`, raw: freight.data };
  const solution = pickFreightSolution(freight.data);
  if (!solution) {
    return { ok: false, error: "freight calculate returned no usable shipping solution", raw: freight.data };
  }

  // Recompute the product total from qty × unit price — never trust a
  // stored total for a money decision.
  const productTotal = Math.round(order.qty * order.unitPrice * 100) / 100;
  const guard = freightGuard({
    productTotal,
    freightFee: solution.freightFee,
    approvedTotal: order.orderTotal,
    perOrderCap,
  });
  if (!guard.allowed) {
    return { ok: false, error: `freight guard refused placement: ${guard.reasons.join(" ")}`, raw: freight.data };
  }

  const created = await orderApiCall(cfg, accessToken, ORDER_METHODS.create, {
    ...buildCreateRequest({
      ref: order.ref,
      carrierCode: solution.carrierCode,
      productId: order.alibabaProductId,
      skuId: order.skuId,
      qty: order.qty,
    }),
  });
  if (!created.ok) return { ok: false, error: `order create failed: ${created.error}`, raw: created.data };
  const parsed = parseCreateResponse(created.data);
  if (!parsed.tradeId) {
    return { ok: false, error: "order create returned no trade_id — treating as not created", raw: created.data };
  }
  return {
    ok: true,
    alibabaOrderId: parsed.tradeId,
    payUrl: parsed.payUrl ?? undefined,
    freightFee: solution.freightFee,
    carrierCode: solution.carrierCode,
    raw: created.data,
  };
}

/** Merge a new payload into the stored raw blob without dropping the
 * placement facts (payUrl / freight / carrier) recorded at create time. */
function mergeStatusRaw(prev: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base =
    prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  return { ...base, ...patch };
}

/** Persist a sync-attempt record (ordersCore.buildSyncAttempt) merged
 * into alibaba_status_raw, stamping last_synced_at — whose meaning is
 * now "the sync last ran" (it is set on failed attempts too, not only
 * on successful Alibaba reads). Best-effort like the sync itself: a
 * failed record write returns the order unchanged instead of throwing. */
async function recordSyncAttempt(
  admin: Admin,
  userId: string,
  order: AlibabaOrderRecord,
  attempt: AlibabaSyncAttempt
): Promise<AlibabaOrderRecord> {
  try {
    const updated = await updateOrder(admin, userId, order.id, {
      alibaba_status_raw: mergeStatusRaw(order.alibabaStatusRaw, { lastSync: attempt }),
      last_synced_at: attempt.at,
    });
    return updated ?? order;
  } catch {
    return order;
  }
}

/** Best-effort status sync for a placed order. Never throws; when the
 * order APIs are not live the order is returned untouched. An
 * awaiting_payment order is checked against the pay-result query FIRST:
 * PAY_SUCCESS moves it to `placed`; anything else is recorded and the
 * order stays awaiting payment.
 *
 * Every exit past the live/id gates records the attempt (lastSync in
 * alibaba_status_raw + last_synced_at) — token failure, pay-result
 * failure, order/get failure, and success alike. The pre-observability
 * version returned silently on the failure paths, so a paid order sat
 * at awaiting_payment with last_synced_at NULL and no trace of which
 * stage had failed (live incident, 2026-10-15). */
export async function syncAlibabaOrderStatus(
  admin: Admin,
  userId: string,
  order: AlibabaOrderRecord,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlibabaOrderRecord> {
  if (!ordersLiveFromEnv(env) || !order.alibabaOrderId) return order;
  if (order.status === "delivered" || order.status === "cancelled") return order;
  const authRes = await getValidAlibabaToken(admin, userId, env);
  if (!authRes.ok || !authRes.token || !authRes.cfg) {
    return recordSyncAttempt(
      admin,
      userId,
      order,
      buildSyncAttempt("token", false, authRes.error ?? "token unavailable")
    );
  }

  let current = order;
  let payNote: string | null = null;
  if (order.status === "awaiting_payment") {
    // trade_id travels as the EXACT STRING. Alibaba trade ids are 18
    // digits — beyond Number.MAX_SAFE_INTEGER — so the previous
    // Number(order.alibabaOrderId) stringified to a DIFFERENT id
    // ("319281522001026345" became "319281522001026370") and the query
    // asked Alibaba about a trade that does not exist: the pay-result
    // leg could never succeed for a real trade.
    const payRes = await orderApiCall(authRes.cfg, authRes.token, ORDER_METHODS.payResultQuery, {
      trade_id: order.alibabaOrderId,
    });
    if (!payRes.ok) {
      return recordSyncAttempt(
        admin,
        userId,
        current,
        buildSyncAttempt("pay_result", false, payRes.error ?? "pay result query failed")
      );
    }
    const pay = parsePayResult(payRes.data);
    const patch: Record<string, unknown> = {
      alibaba_status_raw: mergeStatusRaw(current.alibabaStatusRaw, {
        payResult: payRes.data ?? null,
        ...(pay.payUrl ? { payUrl: pay.payUrl } : {}),
      }),
      last_synced_at: new Date().toISOString(),
    };
    if (pay.paid) patch.status = "placed";
    current = (await updateOrder(admin, userId, order.id, patch)) ?? current;
    if (pay.paid) {
      return recordSyncAttempt(
        admin,
        userId,
        current,
        buildSyncAttempt("done", true, `pay status ${pay.status ?? "PAY_SUCCESS"}`)
      );
    }
    payNote = `pay status ${pay.status ?? "unknown (unparseable response)"}`;
  }

  const res = await orderApiCall(authRes.cfg, authRes.token, ORDER_METHODS.get, {
    order_id: current.alibabaOrderId,
  });
  if (!res.ok) {
    const detail = [payNote, res.error ?? "order get failed"].filter(Boolean).join("; ");
    return recordSyncAttempt(
      admin,
      userId,
      current,
      buildSyncAttempt("order_get", false, detail)
    );
  }
  const data = (res.data ?? {}) as Record<string, unknown>;
  const result = (data.result as Record<string, unknown> | undefined) ?? data;
  const rawStatus = result.status ?? result.order_status ?? result.trade_status;
  const mapped = mapAlibabaOrderStatus(rawStatus);
  const patch: Record<string, unknown> = {
    alibaba_status_raw: mergeStatusRaw(current.alibabaStatusRaw, { orderGet: res.data ?? null }),
    last_synced_at: new Date().toISOString(),
  };
  // Never let a raw order/get status drag an unpaid order out of
  // awaiting_payment — only the pay-result query settles payment.
  if (mapped && mapped !== current.status && current.status !== "awaiting_payment") {
    patch.status = mapped;
  }
  current = (await updateOrder(admin, userId, current.id, patch)) ?? current;
  const detail = [
    payNote,
    `order status ${typeof rawStatus === "string" ? rawStatus : "unknown"}`,
  ]
    .filter(Boolean)
    .join("; ");
  return recordSyncAttempt(admin, userId, current, buildSyncAttempt("done", true, detail));
}
