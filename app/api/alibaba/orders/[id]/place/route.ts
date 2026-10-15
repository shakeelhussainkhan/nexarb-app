import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getValidAlibabaToken } from "@/lib/alibaba/client";
import {
  canTransitionOrder,
  evaluatePlacement,
  ordersLiveFromEnv,
  type IntentStatusForOrder,
} from "@/lib/alibaba/ordersCore";
import {
  ensureComplianceRecords,
  getOrder,
  placeAlibabaOrder,
  reconcileIntentState,
  updateOrder,
} from "@/lib/alibaba/orders";

// POST /api/alibaba/orders/[id]/place  (session only)
//
// The ONLY placement path in the platform, and it is gated twice:
//   1. the order state machine (must be approved / ready_to_place), and
//   2. the linked purchase intent must be APPROVED — re-read here, never
//      trusted from the order row or the client.
// When the Alibaba order APIs are not live-verified (ALIBABA_ORDERS_LIVE
// off — the default), an approved order does NOT error and does NOT
// pretend to be placed: it moves to `ready_to_place`, its compliance
// records (product checklist + import shipment) are created, and the
// response says plainly that no order was sent to Alibaba. When the flag
// is on, the order is created + paid through lib/alibaba/orders.ts and
// the compliance records are created on placement.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity" || identity.via !== "session") {
    return NextResponse.json(
      { success: false, error: "Placing an Alibaba order requires a signed-in session." },
      { status: 403 }
    );
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ success: false, error: "Order id required." }, { status: 400 });
  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  let order = await getOrder(admin, identity.userId, id);
  if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  order = await reconcileIntentState(admin, identity.userId, order);

  // Re-read the intent's status directly — the approval gate.
  let intentStatus: IntentStatusForOrder = null;
  if (order.purchaseIntentId) {
    const { data } = await admin
      .from("purchases")
      .select("status")
      .eq("id", order.purchaseIntentId)
      .maybeSingle();
    intentStatus = data ? (String((data as { status: string }).status) as IntentStatusForOrder) : null;
  }

  const live = ordersLiveFromEnv(process.env);
  const decision = evaluatePlacement({ orderStatus: order.status, intentStatus, ordersLive: live });
  if (!decision.allowed || !decision.outcome) {
    return NextResponse.json(
      { success: false, error: "Order cannot be placed", reasons: decision.reasons },
      { status: 422 }
    );
  }

  if (decision.outcome === "ready_to_place") {
    if (order.status !== "ready_to_place") {
      if (!canTransitionOrder(order.status, "ready_to_place")) {
        return NextResponse.json(
          { success: false, error: `Order is ${order.status} — cannot move to ready_to_place.` },
          { status: 422 }
        );
      }
      order = (await updateOrder(admin, identity.userId, order.id, { status: "ready_to_place" })) ?? order;
    }
    const compliance = await ensureComplianceRecords(admin, identity.userId, order);
    const fresh = (await getOrder(admin, identity.userId, order.id)) ?? order;
    return NextResponse.json({
      success: true,
      placed: false,
      state: "ready_to_place",
      order: fresh,
      compliance,
      note:
        "Approved and ready. NO order was sent to Alibaba: the Alibaba order APIs are not live-verified yet (ALIBABA_ORDERS_LIVE is off), so the order is held at ready_to_place with its compliance shipment + checklist created. It can be placed from here once the order APIs are verified and the flag is enabled.",
    });
  }

  // Live path: create + pay on Alibaba, then create compliance records.
  const authRes = await getValidAlibabaToken(admin, identity.userId);
  if (!authRes.ok || !authRes.token || !authRes.cfg) {
    return NextResponse.json({ success: false, error: authRes.error ?? "Alibaba is not connected." }, { status: 400 });
  }
  const placed = await placeAlibabaOrder(authRes.cfg, authRes.token, order);
  if (!placed.ok) {
    const failed = await updateOrder(admin, identity.userId, order.id, {
      status: "failed",
      alibaba_order_id: placed.alibabaOrderId ?? order.alibabaOrderId,
      alibaba_status_raw: placed.raw ?? { error: placed.error },
    });
    return NextResponse.json(
      { success: false, placed: false, state: "failed", order: failed ?? order, error: placed.error },
      { status: 502 }
    );
  }
  order =
    (await updateOrder(admin, identity.userId, order.id, {
      status: "placed",
      alibaba_order_id: placed.alibabaOrderId,
      alibaba_status_raw: placed.raw ?? null,
      placed_at: new Date().toISOString(),
    })) ?? order;
  const compliance = await ensureComplianceRecords(admin, identity.userId, order);
  const fresh = (await getOrder(admin, identity.userId, order.id)) ?? order;
  return NextResponse.json({
    success: true,
    placed: true,
    state: "placed",
    order: fresh,
    compliance,
  });
}
