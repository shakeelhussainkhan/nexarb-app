import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";

// GET /api/suppliers — supplier offers ingested from distributor catalog
// feeds (Phase 1: Petra), with match + pricing state and ESTIMATED
// economics. Readable with a Clerk session OR a personal API key (same
// pattern as /api/approvals).
//
// Query params:
//   supplier   — default "petra"
//   matched=1  — only offers resolved to an ASIN
//   priced=1   — only offers with a stored Amazon price + estimate
//   candidates=1 — only offers whose evaluation verdict is "candidate"
//                  (migration 019), ranked by eval score
//   q          — search title / brand / SKU / UPC / ASIN
//   minMargin  — minimum est. margin percent (e.g. 25)
//   limit      — default 200, max 500
//
// estNet / estMarginPct are ESTIMATES (live Amazon price minus supplier
// cost, $1.50/unit prep, and estimated referral/FBA fees) — the dashboard
// labels them as such; they are never exact per-ASIN fees.

interface OfferRow {
  id: string;
  supplier: string;
  supplier_sku: string;
  vendor_sku: string | null;
  title: string;
  brand: string | null;
  upc: string | null;
  cost_price: number | string;
  map_price: number | string | null;
  msrp: number | string | null;
  qty_available: number;
  image_url: string | null;
  product_class: string | null;
  subcategory: string | null;
  weight_lb: number | string | null;
  origin_country: string | null;
  matched_asin: string | null;
  match_status: string;
  amazon_price: number | string | null;
  est_net: number | string | null;
  est_margin_pct: number | string | null;
  priced_at: string | null;
  eval_verdict: string | null;
  eval_score: number | string | null;
  eval_reasons: unknown;
  evaluated_at: string | null;
  promoted_watchlist_asin: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const num = (v: number | string | null): number | null =>
  v === null ? null : Number(v);

export async function GET(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const supplier = (url.searchParams.get("supplier") ?? "petra").trim() || "petra";
  const matchedOnly = url.searchParams.get("matched") === "1";
  const pricedOnly = url.searchParams.get("priced") === "1";
  const candidatesOnly = url.searchParams.get("candidates") === "1";
  const q = (url.searchParams.get("q") ?? "").replace(/[%_,()]/g, " ").trim();
  const minMarginRaw = Number(url.searchParams.get("minMargin"));
  const minMargin = Number.isFinite(minMarginRaw) && url.searchParams.has("minMargin")
    ? minMarginRaw
    : null;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 500) : 200;

  try {
    const admin = getSupabaseAdmin();

    // Summary counts for the supplier (independent of row filters).
    const countFor = async (build: (qb: ReturnType<typeof baseCount>) => ReturnType<typeof baseCount>) => {
      const { count } = await build(baseCount());
      return count ?? 0;
    };
    const baseCount = () =>
      admin.from("supplier_offers").select("id", { count: "exact", head: true }).eq("supplier", supplier);
    const [total, matched, pending, priced, candidates] = await Promise.all([
      countFor((qb) => qb),
      countFor((qb) => qb.eq("match_status", "matched")),
      countFor((qb) => qb.eq("match_status", "pending")),
      countFor((qb) => qb.not("priced_at", "is", null)),
      countFor((qb) => qb.eq("eval_verdict", "candidate")),
    ]);

    let query = admin
      .from("supplier_offers")
      .select(
        "id, supplier, supplier_sku, vendor_sku, title, brand, upc, cost_price, map_price, msrp, qty_available, image_url, product_class, subcategory, weight_lb, origin_country, matched_asin, match_status, amazon_price, est_net, est_margin_pct, priced_at, eval_verdict, eval_score, eval_reasons, evaluated_at, promoted_watchlist_asin, first_seen_at, last_seen_at"
      )
      .eq("supplier", supplier)
      .limit(limit);
    if (candidatesOnly) {
      // The shortlist ranks by evaluation score, not raw margin.
      query = query
        .order("eval_score", { ascending: false, nullsFirst: false })
        .order("last_seen_at", { ascending: false });
    } else {
      query = query
        .order("est_margin_pct", { ascending: false, nullsFirst: false })
        .order("last_seen_at", { ascending: false });
    }
    if (matchedOnly) query = query.eq("match_status", "matched");
    if (pricedOnly) query = query.not("priced_at", "is", null);
    if (candidatesOnly) query = query.eq("eval_verdict", "candidate");
    if (minMargin !== null) query = query.gte("est_margin_pct", minMargin);
    if (q) {
      query = query.or(
        `title.ilike.%${q}%,brand.ilike.%${q}%,supplier_sku.ilike.%${q}%,upc.ilike.%${q}%,matched_asin.ilike.%${q}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    const offers = ((data ?? []) as OfferRow[]).map((r) => ({
      id: r.id,
      supplier: r.supplier,
      supplierSku: r.supplier_sku,
      vendorSku: r.vendor_sku,
      title: r.title,
      brand: r.brand,
      upc: r.upc,
      costPrice: Number(r.cost_price),
      mapPrice: num(r.map_price),
      msrp: num(r.msrp),
      qtyAvailable: r.qty_available,
      imageUrl: r.image_url,
      productClass: r.product_class,
      subcategory: r.subcategory,
      weightLb: num(r.weight_lb),
      originCountry: r.origin_country,
      matchedAsin: r.matched_asin,
      matchStatus: r.match_status,
      amazonPrice: num(r.amazon_price),
      estNet: num(r.est_net),
      estMarginPct: num(r.est_margin_pct),
      pricedAt: r.priced_at,
      evalVerdict: r.eval_verdict,
      evalScore: num(r.eval_score),
      evalReasons: Array.isArray(r.eval_reasons)
        ? r.eval_reasons.filter((x): x is string => typeof x === "string")
        : [],
      evaluatedAt: r.evaluated_at,
      promotedAsin: r.promoted_watchlist_asin,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }));
    return NextResponse.json({
      success: true,
      summary: { supplier, total, matched, pending, priced, candidates },
      offers,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Could not read supplier offers." },
      { status: 500 }
    );
  }
}
