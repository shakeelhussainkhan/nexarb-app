import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { setListingPrice } from "@/lib/spapi/listings";
import { setWalmartPrice } from "@/lib/walmart/listings";
import { walmartConfigFromEnv } from "@/lib/walmart/client";
import { validateRepriceBounds } from "@/lib/engine/listingSync";

// POST /api/listings/[id]/reprice
// Manual price change on a LIVE listing. This touches real money.
//
// Body: { price: number }
//
// Guards, in order:
//   1. Clerk auth (401)
//   2. The listing must exist in OUR listings table (404) — we never
//      invent a listing or price, and we never write to a SKU we don't
//      track.
//   3. The price must be positive and inside the founder-approved
//      watchlist bounds (price_min/price_max) when set — otherwise 422
//      with the real reason.
//   4. The channel write must succeed — if Amazon/Walmart refuses, the
//      local row is NOT updated and the failure is audit-logged.
// Every attempt (applied or failed) writes a row to reprice_audit.
// Never throws: every failure path returns JSON.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "Listing id required" }, { status: 400 });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const price = Number((raw as Record<string, unknown>).price);

    const sb = getSupabaseAdmin();
    const { data: row, error: loadError } = await sb
      .from("listings")
      .select("id, channel, seller_sku, asin, our_price")
      .eq("id", id)
      .maybeSingle();
    if (loadError || !row) {
      return NextResponse.json({ error: "Listing not found in the synced listings table." }, { status: 404 });
    }
    const listing = row as { id: string; channel: string; seller_sku: string; asin: string | null; our_price: number | null };

    // Founder-approved bounds from the watchlist (by ASIN when known).
    let priceMin: number | null = null;
    let priceMax: number | null = null;
    if (listing.asin) {
      const { data: wl } = await sb
        .from("watchlist")
        .select("price_min, price_max")
        .eq("asin", listing.asin)
        .maybeSingle();
      const w = wl as { price_min: unknown; price_max: unknown } | null;
      const pm = w?.price_min != null ? Number(w.price_min) : null;
      const px = w?.price_max != null ? Number(w.price_max) : null;
      priceMin = pm != null && pm > 0 ? pm : null;
      priceMax = px != null && px > 0 ? px : null;
    }

    const boundCheck = validateRepriceBounds(price, priceMin, priceMax);
    if (!boundCheck.ok) {
      return NextResponse.json({ error: boundCheck.reason }, { status: 422 });
    }
    const rounded = Math.round(price * 100) / 100;

    // Channel write.
    let write: { ok: boolean; reason: string };
    if (listing.channel === "amazon") {
      const cfg = spApiConfigFromEnv(process.env);
      if (!cfg) {
        write = { ok: false, reason: "SP-API not configured — cannot write the price." };
      } else {
        write = await setListingPrice(cfg, listing.seller_sku, rounded);
      }
    } else {
      const cfg = walmartConfigFromEnv(process.env);
      if (!cfg) {
        write = { ok: false, reason: "Walmart API not configured — cannot write the price." };
      } else {
        write = await setWalmartPrice(cfg, listing.seller_sku, rounded);
      }
    }

    // Audit every attempt.
    const oldPrice = listing.our_price != null ? Number(listing.our_price) : null;
    try {
      await sb.from("reprice_audit").insert({
        listing_id: listing.id,
        channel: listing.channel,
        seller_sku: listing.seller_sku,
        asin: listing.asin,
        old_price: oldPrice,
        new_price: rounded,
        actor: userId,
        channel_result: write.ok ? "applied" : "failed",
        channel_error: write.ok ? null : write.reason,
      });
    } catch {
      // Non-fatal: the channel result stands, audit insert failed.
    }

    if (!write.ok) {
      return NextResponse.json(
        { error: "The marketplace refused the price change.", reasons: [write.reason] },
        { status: 422 }
      );
    }

    // Local mirror follows the channel's confirmed result.
    try {
      await sb
        .from("listings")
        .update({ our_price: rounded, updated_at: new Date().toISOString() })
        .eq("id", listing.id);
    } catch {
      // Non-fatal: channel has the new price; mirror will catch up on sync.
    }

    return NextResponse.json({
      success: true,
      listingId: listing.id,
      channel: listing.channel,
      sellerSku: listing.seller_sku,
      oldPrice,
      newPrice: rounded,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Reprice failed", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 500 }
    );
  }
}
