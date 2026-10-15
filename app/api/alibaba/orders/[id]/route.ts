import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ordersLiveFromEnv } from "@/lib/alibaba/ordersCore";
import {
  getOrder,
  reconcileIntentState,
  syncAlibabaOrderStatus,
} from "@/lib/alibaba/orders";

// GET /api/alibaba/orders/[id] — one order, session or API key.
// Reconciles the linked intent's decision, then attempts a status sync
// against Alibaba when the order APIs are live (flag on + placed);
// otherwise the stored state is returned as-is.

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ success: false, error: "Order id required." }, { status: 400 });
  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  let order = await getOrder(admin, identity.userId, id);
  if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });

  order = await reconcileIntentState(admin, identity.userId, order);
  order = await syncAlibabaOrderStatus(admin, identity.userId, order);

  let intentStatus: string | null = null;
  if (order.purchaseIntentId) {
    const { data } = await admin
      .from("purchases")
      .select("status")
      .eq("id", order.purchaseIntentId)
      .maybeSingle();
    intentStatus = data ? String((data as { status: string }).status) : null;
  }
  return NextResponse.json({
    success: true,
    order: { ...order, intentStatus },
    ordersLive: ordersLiveFromEnv(process.env),
  });
}
