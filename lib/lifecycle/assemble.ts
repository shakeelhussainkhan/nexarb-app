// Order lifecycle — server assembly.
//
// The ONE assembly of OrderJourney[] from the source tables
// (alibaba_orders + linked import_shipments + purchases intents +
// sales_events aggregates + external_orders), shared by
// GET /api/orders/journeys (PR-D1) and GET /api/dashboard/metrics
// (PR-E1) so both surfaces render the same journeys from the same
// code. The inclusion rules live here, next to the code:
//
// RETAIL INCLUSION RULE: an intent becomes a retail journey when it
// is APPROVED or EXECUTED and is NOT linked to an Alibaba order (a
// linked intent's journey is the Alibaba order's — the intent only
// contributes its approval timestamps there). PENDING_APPROVAL
// intents are asks, not orders, and REJECTED intents are decisions,
// not journeys; both are excluded.
//
// Throws on a source failure (the journeys route turns that into a
// 500; the metrics route isolates it into its sourceErrors map).

import { getSupabaseAdmin } from "@/lib/supabase";
import { listOrders } from "@/lib/alibaba/orders";
import { listExternalOrders } from "./external";
import {
  journeyFromAlibabaOrder,
  journeyFromExternalOrder,
  journeyFromIntent,
  sortJourneys,
  type IntentJourneyInput,
  type OrderJourney,
  type SalesAggregate,
  type ShipmentJourneyInput,
} from "./core";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface SalesRowLite {
  asin: string;
  qty: number;
  sold_at: string | null;
}

/** Per-ASIN sales aggregates ({unitsSold, lastSoldAt}) — the `selling`
 * stage evidence for every journey kind. sales_events has no user_id
 * (migration 005); read exactly like /dashboard/pnl does. */
export function salesAggregates(sales: SalesRowLite[]): Map<string, SalesAggregate> {
  const byAsin = new Map<string, SalesAggregate>();
  for (const row of sales) {
    const agg = byAsin.get(row.asin) ?? { asin: row.asin, unitsSold: 0, lastSoldAt: null };
    agg.unitsSold += Number(row.qty) || 0;
    if (row.sold_at && (!agg.lastSoldAt || row.sold_at > agg.lastSoldAt)) agg.lastSoldAt = row.sold_at;
    byAsin.set(row.asin, agg);
  }
  return byAsin;
}

export async function assembleJourneys(
  admin: Admin,
  userId: string,
  preloadedSales?: SalesRowLite[]
): Promise<OrderJourney[]> {
  const orders = await listOrders(admin, userId, 200);

  const orderIds = orders.map((o) => o.id);
  const shipmentByOrderId = new Map<string, ShipmentJourneyInput>();
  const shipmentById = new Map<string, ShipmentJourneyInput>();
  if (orderIds.length > 0) {
    const { data } = await admin
      .from("import_shipments")
      .select("id, status, updated_at, alibaba_order_id")
      .eq("user_id", userId)
      .in("alibaba_order_id", orderIds);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const s: ShipmentJourneyInput = {
        status: String(row.status),
        updatedAt: String(row.updated_at),
      };
      if (row.alibaba_order_id) shipmentByOrderId.set(String(row.alibaba_order_id), s);
      shipmentById.set(String(row.id), s);
    }
  }

  // Purchase intents: the ones linked from Alibaba orders (approval
  // stamps) plus every APPROVED/EXECUTED intent (retail journeys).
  // purchases has no user_id (migration 004) — GET /api/purchases
  // reads it the same unscoped way; the app is single-operator.
  const linkedIntentIds = [
    ...new Set(orders.map((o) => o.purchaseIntentId).filter((v): v is string => Boolean(v))),
  ];
  const intentById = new Map<string, IntentJourneyInput>();
  const loadIntents = (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      intentById.set(String(row.id), {
        id: String(row.id),
        asin: String(row.asin),
        qty: Number(row.qty),
        unitPrice: Number(row.unit_price),
        status: String(row.status),
        createdAt: String(row.created_at),
        decidedAt: row.decided_at ? String(row.decided_at) : null,
        decisionReason: row.decision_reason ? String(row.decision_reason) : null,
        retailerUrl: row.retailer_url ? String(row.retailer_url) : null,
        checkoutStatus: row.checkout_status ? String(row.checkout_status) : "none",
      });
    }
  };
  const intentCols =
    "id, asin, qty, unit_price, status, created_at, decided_at, decision_reason, retailer_url, checkout_status";
  if (linkedIntentIds.length > 0) {
    const res = await admin.from("purchases").select(intentCols).in("id", linkedIntentIds);
    if (res.error) throw new Error(`purchases (linked intents) failed: ${res.error.message}`);
    loadIntents((res.data ?? []) as Array<Record<string, unknown>>);
  }
  {
    const res = await admin
      .from("purchases")
      .select(intentCols)
      .in("status", ["APPROVED", "EXECUTED"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (res.error) throw new Error(`purchases (retail intents) failed: ${res.error.message}`);
    loadIntents((res.data ?? []) as Array<Record<string, unknown>>);
  }

  let salesByAsin: Map<string, SalesAggregate>;
  if (preloadedSales) {
    salesByAsin = salesAggregates(preloadedSales);
  } else {
    const { data, error } = await admin
      .from("sales_events")
      .select("asin, qty, sold_at")
      .limit(5000);
    if (error) throw new Error(`sales_events failed: ${error.message}`);
    salesByAsin = salesAggregates(
      ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        asin: String(row.asin),
        qty: Number(row.qty) || 0,
        sold_at: row.sold_at ? String(row.sold_at) : null,
      }))
    );
  }

  const external = await listExternalOrders(admin, userId, 100);

  const journeys: OrderJourney[] = [];

  for (const order of orders) {
    const shipment =
      shipmentByOrderId.get(order.id) ??
      (order.shipmentId ? shipmentById.get(order.shipmentId) : undefined) ??
      null;
    const intent = order.purchaseIntentId ? intentById.get(order.purchaseIntentId) ?? null : null;
    journeys.push(
      journeyFromAlibabaOrder(order, shipment, order.targetAsin ? salesByAsin.get(order.targetAsin) ?? null : null, {
        intent,
      })
    );
  }

  const linkedSet = new Set(linkedIntentIds);
  for (const intent of intentById.values()) {
    if (linkedSet.has(intent.id)) continue; // represented by its Alibaba journey
    if (intent.status !== "APPROVED" && intent.status !== "EXECUTED") continue;
    journeys.push(journeyFromIntent(intent, null, salesByAsin.get(intent.asin) ?? null));
  }

  for (const row of external) {
    journeys.push(journeyFromExternalOrder(row));
  }

  return sortJourneys(journeys);
}
