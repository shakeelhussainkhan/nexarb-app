import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getValidAlibabaToken, getAlibabaProduct } from "@/lib/alibaba/client";
import { bestLandedCost } from "@/lib/alibaba/core";
import { screenProduct } from "@/lib/compliance/core";
import {
  draftBlockReason,
  newAlibabaOrderRef,
  ordersLiveFromEnv,
  totalsFromLandedWithFreight,
} from "@/lib/alibaba/ordersCore";
import {
  insertOrder,
  listOrders,
  quoteDraftFreight,
  reconcileIntentState,
  type AlibabaOrderRecord,
} from "@/lib/alibaba/orders";

// /api/alibaba/orders
// POST (session only): draft an order from a sourced Alibaba product.
//   Pricing is recomputed SERVER-SIDE from the live product description
//   with the same MOQ/ladder landed-cost math as sourcing — the client
//   never asserts a price. The draft total carries REAL freight, quoted
//   live from /order/freight/calculate: the description's nominal
//   shipping figure is not a freight price, and an approval is only
//   meaningful against a true total — so when freight cannot be quoted
//   the draft fails (422) instead of falling back to the nominal fee.
//   Compliance screening runs here: a BLOCKED product cannot become an
//   order (422). A draft spends nothing; it can only move forward by
//   becoming a purchase intent (purchases pipeline).
// GET (session or API key): list the caller's orders, newest first, with
//   each linked intent's current status so the UI can show the approval
//   state without a second round-trip.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity" || identity.via !== "session") {
    return NextResponse.json(
      { success: false, error: "Drafting an Alibaba order requires a signed-in session." },
      { status: 403 }
    );
  }
  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  let body: { productId?: string; qty?: number; asin?: string; sellPrice?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const productId = (body.productId ?? "").trim();
  if (!productId) {
    return NextResponse.json({ success: false, error: "Body must include productId." }, { status: 400 });
  }
  const qty = Number.isFinite(body.qty) && (body.qty as number) > 0 ? Math.floor(body.qty as number) : 10;
  const asin = (body.asin ?? "").trim().toUpperCase();
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ success: false, error: "asin must be a valid 10-character ASIN." }, { status: 400 });
  }
  const sellPrice =
    body.sellPrice !== undefined && Number.isFinite(body.sellPrice) && (body.sellPrice as number) > 0
      ? Number(body.sellPrice)
      : null;

  const admin = getSupabaseAdmin();
  const authRes = await getValidAlibabaToken(admin, identity.userId);
  if (!authRes.ok || !authRes.token || !authRes.cfg) {
    return NextResponse.json({ success: false, error: authRes.error ?? "Alibaba is not connected." }, { status: 400 });
  }

  const detailRes = await getAlibabaProduct(authRes.cfg, authRes.token, productId);
  if (!detailRes.ok || !detailRes.detail) {
    return NextResponse.json(
      { success: false, error: detailRes.error ?? "Alibaba product lookup failed." },
      { status: 502 }
    );
  }
  const detail = detailRes.detail;

  // Compliance gate — BLOCKED offers are excluded from sourcing results
  // for the same reason; an order must never exist for one.
  const screening = screenProduct({ title: detail.title, supplierName: detail.supplierName });
  const blockReason = draftBlockReason(screening);
  if (blockReason) {
    return NextResponse.json({ success: false, error: blockReason, screening }, { status: 422 });
  }

  const landed = bestLandedCost(detail, qty);
  if (!landed) {
    return NextResponse.json(
      { success: false, error: "No usable price for this product (no ladder or cost price)." },
      { status: 422 }
    );
  }

  // Real freight, quoted now: the totals the founder will approve must
  // be the totals placement will charge. No quote -> no draft.
  const freightRes = await quoteDraftFreight(authRes.cfg, authRes.token, {
    eCompanyId: detail.eCompanyId,
    productId: detail.productId,
    skuId: landed.skuId || null,
    qty: landed.orderQty,
  });
  if (!freightRes.ok || !freightRes.quote) {
    return NextResponse.json(
      { success: false, error: freightRes.error ?? "could not quote freight" },
      { status: 422 }
    );
  }
  const totals = totalsFromLandedWithFreight(landed, freightRes.quote.freightFee);

  const inserted = await insertOrder(admin, {
    userId: identity.userId,
    ref: newAlibabaOrderRef(),
    alibabaProductId: detail.productId,
    skuId: landed.skuId || null,
    title: detail.title,
    imageUrl: detail.mainImage,
    detailUrl: detail.detailUrl,
    supplierName: detail.supplierName,
    targetAsin: asin || null,
    expectedSellPrice: sellPrice,
    totals,
    currency: detail.currency ?? "USD",
    moq: detail.moq,
    offerSnapshot: { detail, landed },
    screening,
    freightQuote: freightRes.quote,
  });
  if (!inserted.ok || !inserted.order) {
    return NextResponse.json({ success: false, error: inserted.error ?? "Could not save the draft order." }, { status: 500 });
  }
  return NextResponse.json({ success: true, order: inserted.order }, { status: 201 });
}

export type OrderWithIntent = AlibabaOrderRecord & { intentStatus: string | null };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: true, orders: [], ordersLive: ordersLiveFromEnv(process.env) });
  }
  const admin = getSupabaseAdmin();
  const listed = await listOrders(admin, identity.userId);
  const orders: AlibabaOrderRecord[] = [];
  for (const o of listed) orders.push(await reconcileIntentState(admin, identity.userId, o));

  // Attach each linked intent's status (one batched lookup).
  const intentIds = orders.map((o) => o.purchaseIntentId).filter((v): v is string => Boolean(v));
  const intentStatusById = new Map<string, string>();
  if (intentIds.length > 0) {
    const { data } = await admin.from("purchases").select("id, status").in("id", intentIds);
    for (const row of (data ?? []) as Array<{ id: string; status: string }>) {
      intentStatusById.set(row.id, row.status);
    }
  }
  const withIntent: OrderWithIntent[] = orders.map((o) => ({
    ...o,
    intentStatus: o.purchaseIntentId ? (intentStatusById.get(o.purchaseIntentId) ?? null) : null,
  }));
  return NextResponse.json({ success: true, orders: withIntent, ordersLive: ordersLiveFromEnv(process.env) });
}
