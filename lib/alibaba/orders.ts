// Alibaba order flow — server module.
//
// Database access for alibaba_orders (migration 020), the compliance
// record creation that accompanies placement, status sync, and the
// Alibaba order API calls themselves.
//
// ⚠️ UNVERIFIED ORDER APIs: the method names below come from Alibaba's
// developer-docs index (findings doc, 2026-10-13): /buynow/order/create,
// /alibaba/dropshipping/order/pay, /alibaba/order/get|list|cancel and a
// freight-calculate endpoint. Unlike search/description, NONE of them has
// ever returned a real response to this app — exact business-parameter
// names/shapes are NOT verified. Every call therefore sits behind the
// ALIBABA_ORDERS_LIVE env flag (default OFF, lib/alibaba/ordersCore.ts):
// with the flag off, an approved order moves to `ready_to_place` and NO
// order call is attempted. When the flag is on, all order traffic goes
// through the single orderApiCall() below so verification/fixes land in
// exactly one place.

import { getSupabaseAdmin } from "@/lib/supabase";
import type { AlibabaConfig } from "./core";
import { callAlibabaApi, getValidAlibabaToken } from "./client";
import {
  mapAlibabaOrderStatus,
  ordersLiveFromEnv,
  type AlibabaOrderStatus,
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
  placedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

// --- Alibaba order API calls (UNVERIFIED — flag-gated) --------------------------

const ORDER_METHODS = {
  // Price/freight confirmation before creating (docs: "freight calculate").
  freightCalculate: "/alibaba/dropshipping/freight/calculate",
  create: "/buynow/order/create",
  pay: "/alibaba/dropshipping/order/pay",
  get: "/alibaba/order/get",
  list: "/alibaba/order/list",
  cancel: "/alibaba/order/cancel",
} as const;

/**
 * THE single place every Alibaba order call goes through. Business params
 * ride in a `param0` JSON wrapper (the pattern the verified sourcing APIs
 * use for search); whether the order APIs accept that wrapper is part of
 * what live verification must establish.
 */
async function orderApiCall(
  cfg: AlibabaConfig,
  accessToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return callAlibabaApi(cfg, accessToken, method, { param0: JSON.stringify(payload) }, "POST");
}

export interface PlaceResult {
  ok: boolean;
  alibabaOrderId?: string;
  raw?: unknown;
  error?: string;
}

/** Preview (freight/price confirmation) → create → pay. Stops at the first
 * failure and reports which step failed; a created-but-unpaid order id is
 * still returned so it can be recorded, never silently dropped. */
export async function placeAlibabaOrder(
  cfg: AlibabaConfig,
  accessToken: string,
  order: AlibabaOrderRecord
): Promise<PlaceResult> {
  const line = {
    product_id: order.alibabaProductId,
    sku_id: order.skuId,
    quantity: order.qty,
  };
  const preview = await orderApiCall(cfg, accessToken, ORDER_METHODS.freightCalculate, {
    items: [line],
    ship_to_country: "US",
    currency: order.currency,
  });
  if (!preview.ok) return { ok: false, error: `preview (freight calculate) failed: ${preview.error}`, raw: preview.data };

  const created = await orderApiCall(cfg, accessToken, ORDER_METHODS.create, {
    items: [line],
    ship_to_country: "US",
    currency: order.currency,
    total_amount: order.orderTotal,
    out_order_id: order.ref,
  });
  if (!created.ok) return { ok: false, error: `order create failed: ${created.error}`, raw: created.data };
  const createdRec = (created.data ?? {}) as Record<string, unknown>;
  const resultRec = (createdRec.result as Record<string, unknown> | undefined) ?? createdRec;
  const alibabaOrderId =
    typeof resultRec.order_id === "string"
      ? resultRec.order_id
      : typeof resultRec.orderId === "string"
        ? resultRec.orderId
        : undefined;
  if (!alibabaOrderId) {
    return { ok: false, error: "order create returned no order id — treating as not placed", raw: created.data };
  }

  const paid = await orderApiCall(cfg, accessToken, ORDER_METHODS.pay, { order_id: alibabaOrderId });
  if (!paid.ok) {
    return { ok: false, alibabaOrderId, error: `order created (${alibabaOrderId}) but pay failed: ${paid.error}`, raw: paid.data };
  }
  return { ok: true, alibabaOrderId, raw: paid.data };
}

/** Best-effort status sync for a placed order. Never throws; when the
 * order APIs are not live the order is returned untouched. */
export async function syncAlibabaOrderStatus(
  admin: Admin,
  userId: string,
  order: AlibabaOrderRecord,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlibabaOrderRecord> {
  if (!ordersLiveFromEnv(env) || !order.alibabaOrderId) return order;
  if (order.status === "delivered" || order.status === "cancelled") return order;
  const authRes = await getValidAlibabaToken(admin, userId, env);
  if (!authRes.ok || !authRes.token || !authRes.cfg) return order;
  const res = await orderApiCall(authRes.cfg, authRes.token, ORDER_METHODS.get, {
    order_id: order.alibabaOrderId,
  });
  if (!res.ok) return order;
  const data = (res.data ?? {}) as Record<string, unknown>;
  const result = (data.result as Record<string, unknown> | undefined) ?? data;
  const rawStatus = result.status ?? result.order_status ?? result.trade_status;
  const mapped = mapAlibabaOrderStatus(rawStatus);
  const patch: Record<string, unknown> = {
    alibaba_status_raw: res.data ?? null,
    last_synced_at: new Date().toISOString(),
  };
  if (mapped && mapped !== order.status) patch.status = mapped;
  return (await updateOrder(admin, userId, order.id, patch)) ?? order;
}
