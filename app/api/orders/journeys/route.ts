import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { listOrders } from "@/lib/alibaba/orders";
import { listExternalOrders } from "@/lib/lifecycle/external";
import {
  journeyFromAlibabaOrder,
  journeyFromExternalOrder,
  journeyFromIntent,
  sortJourneys,
  type IntentJourneyInput,
  type OrderJourney,
  type SalesAggregate,
  type ShipmentJourneyInput,
} from "@/lib/lifecycle/core";

// GET /api/orders/journeys
//
// The unified order-lifecycle view (PR-D1): every order Five S has in
// flight, from every source, expressed in the canonical stage
// vocabulary of lib/lifecycle/core.ts —
//   · alibaba_orders (+ their linked import_shipments, linked purchase
//     intents for approval stamps, and per-ASIN sales aggregates),
//   · purchases intents (retail journeys),
//   · external_orders (orders placed outside the app, migration 023).
//
// INCLUSION RULES (retail): an intent becomes a retail journey when it
// is APPROVED or EXECUTED and is NOT linked to an Alibaba order (a
// linked intent's journey is the Alibaba order's — the intent only
// contributes its approval timestamps there). PENDING_APPROVAL intents
// are asks, not orders (the dashboard already counts them), and
// REJECTED intents are decisions, not journeys; both are excluded.
//
// Auth: Clerk session OR personal API key (X-NexArb-Key) via
// resolveUser — same pattern as GET /api/purchases and the other
// cron-readable GETs (proxy.ts bypasses this exact path).
//
// Response: { journeys: OrderJourney[] } sorted exceptions-first,
// then by latest stage timestamp desc (lib/lifecycle/core sortJourneys).
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { error: "Supabase is not configured in this environment, so no journeys can be assembled." },
        { status: 503 }
      );
    }
    const admin = getSupabaseAdmin();
    const userId = identity.userId;

    // ── Sources ──────────────────────────────────────────────────────
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
    const loadIntents = async (query: {
      data: Array<Record<string, unknown>> | null;
    }) => {
      for (const row of query.data ?? []) {
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
      await loadIntents(res as { data: Array<Record<string, unknown>> | null });
    }
    {
      const res = await admin
        .from("purchases")
        .select(intentCols)
        .in("status", ["APPROVED", "EXECUTED"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (res.error) throw new Error(`purchases (retail intents) failed: ${res.error.message}`);
      await loadIntents(res as { data: Array<Record<string, unknown>> | null });
    }

    // Per-ASIN sales aggregates from sales_events (no user_id on that
    // table — migration 005; read exactly like /dashboard/pnl does).
    const salesByAsin = new Map<string, SalesAggregate>();
    {
      const { data, error } = await admin
        .from("sales_events")
        .select("asin, qty, sold_at")
        .limit(5000);
      if (error) throw new Error(`sales_events failed: ${error.message}`);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const asin = String(row.asin);
        const agg = salesByAsin.get(asin) ?? { asin, unitsSold: 0, lastSoldAt: null };
        agg.unitsSold += Number(row.qty) || 0;
        const soldAt = row.sold_at ? String(row.sold_at) : null;
        if (soldAt && (!agg.lastSoldAt || soldAt > agg.lastSoldAt)) agg.lastSoldAt = soldAt;
        salesByAsin.set(asin, agg);
      }
    }

    const external = await listExternalOrders(admin, userId, 100);

    // ── Assembly ─────────────────────────────────────────────────────
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

    return NextResponse.json({ journeys: sortJourneys(journeys) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not assemble order journeys." },
      { status: 500 }
    );
  }
}
