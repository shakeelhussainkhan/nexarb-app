import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getValidAlibabaToken, searchAlibabaProducts, getAlibabaProduct } from "@/lib/alibaba/client";
import { bestLandedCost } from "@/lib/alibaba/core";
import { buildWatchlistPayload } from "@/lib/sourcing/orchestrate";

// POST /api/sourcing/alibaba
//
// Alibaba as a BUY source: keyword-search Alibaba with the founder's
// connected buyer account, price the top results properly (MOQ-aware
// ladder price + shipping = landed cost per unit), and optionally track
// the cheapest offer as the buy price for an Amazon ASIN on the
// watchlist — from there the normal scan pipeline verifies it against
// live Amazon prices and eligibility before any BUY verdict.
//
// Body: { keyword, asin?, qty?, size?, addBestToWatchlist? }
// Auth: Clerk session OR personal API key.
// DISCOVERY ONLY — searches and reads prices; never orders anything.

const MAX_DETAIL_LOOKUPS = 10;

interface Offer {
  productId: string;
  title: string;
  image: string | null;
  supplier: string | null;
  moq: number;
  orderQty: number;
  unitPrice: number;
  shippingPerUnit: number;
  landedPerUnit: number;
  detailUrl: string | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  let body: { keyword?: string; asin?: string; qty?: number; size?: number; addBestToWatchlist?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const keyword = (body.keyword ?? "").trim();
  if (!keyword) {
    return NextResponse.json({ success: false, error: "Body must include a non-empty keyword." }, { status: 400 });
  }
  const asin = (body.asin ?? "").trim().toUpperCase();
  const qty = Number.isFinite(body.qty) && (body.qty as number) > 0 ? Math.floor(body.qty as number) : 10;
  const size = Math.min(Math.max(Number.isFinite(body.size) ? Math.floor(body.size as number) : 5, 1), MAX_DETAIL_LOOKUPS);

  const admin = getSupabaseAdmin();
  const authRes = await getValidAlibabaToken(admin, identity.userId);
  if (!authRes.ok || !authRes.token || !authRes.cfg) {
    return NextResponse.json({ success: false, error: authRes.error ?? "Alibaba is not connected." }, { status: 400 });
  }

  const search = await searchAlibabaProducts(authRes.cfg, authRes.token, { keyword, size: Math.max(size, 5) });
  if (!search.ok || !search.hits) {
    return NextResponse.json({ success: false, error: search.error ?? "Alibaba search failed." }, { status: 502 });
  }

  const notes: string[] = [];
  const offers: Offer[] = [];
  for (const hit of search.hits.slice(0, size)) {
    const res = await getAlibabaProduct(authRes.cfg, authRes.token, hit.productId);
    if (!res.ok || !res.detail) {
      notes.push(`Product ${hit.productId}: ${res.error ?? "detail lookup failed"}`);
      continue;
    }
    const landed = bestLandedCost(res.detail, qty);
    if (!landed) {
      notes.push(`Product ${hit.productId}: no usable price (no ladder or cost price).`);
      continue;
    }
    offers.push({
      productId: res.detail.productId,
      title: res.detail.title,
      image: res.detail.mainImage ?? hit.mainImage,
      supplier: res.detail.supplierName,
      moq: landed.moq,
      orderQty: landed.orderQty,
      unitPrice: landed.unitPrice,
      shippingPerUnit: landed.shippingPerUnit,
      landedPerUnit: landed.landedPerUnit,
      detailUrl: res.detail.detailUrl ?? hit.detailUrl,
    });
  }
  offers.sort((a, b) => a.landedPerUnit - b.landedPerUnit);

  // Optionally track the cheapest offer as the buy price for an ASIN.
  let added = false;
  let alreadyTracked = false;
  if (asin && body.addBestToWatchlist && offers.length > 0) {
    const best = offers[0];
    const { data: existingRows } = await admin.from("watchlist").select("asin, title").eq("asin", asin);
    const existing = ((existingRows ?? []) as Array<{ asin: string; title: string | null }>).map((r) => r.asin);
    alreadyTracked = existing.length > 0;
    if (!alreadyTracked) {
      const rows = buildWatchlistPayload(
        [{ asin, title: best.title, buyPrice: best.landedPerUnit, sourceUrl: best.detailUrl }],
        existing,
        { buySource: "alibaba" }
      );
      if (rows.length > 0) {
        const { error: writeError } = await admin
          .from("watchlist")
          .upsert(rows, { onConflict: "asin", ignoreDuplicates: true });
        if (writeError) notes.push(`Watchlist add failed: ${writeError.message}`);
        else added = true;
      }
    }
  }

  return NextResponse.json({
    success: true,
    keyword,
    offers,
    added,
    alreadyTracked,
    notes,
    searchShape: search.shape ?? null,
  });
}
