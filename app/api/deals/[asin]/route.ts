import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { velocityReport } from "@/lib/engine/velocity";
import { dealFromCheckRow, type Deal, type DealCheckRow } from "@/lib/engine/dealCore";
import {
  buildDealDetail,
  type WatchlistFacts,
} from "@/lib/engine/dealDetailCore";
import { backfillWatchlistProductInfo } from "@/lib/engine/productBackfill";
import type { MarketSnapshot } from "@/lib/data/types";

// GET /api/deals/[asin] — one aggregated detail payload for the deal
// details page: the same Deal the list computes (shared mapping in
// lib/engine/dealCore.ts), plus watchlist/source facts, the latest 10
// checks, Buy Box winner observations, and the approval-queue entry.
// Session-only, consistent with the deals list route. Never throws:
// enrichment failures degrade to placeholders, and an ASIN with no
// watchlist row and no checks is a clean 404.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ asin: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { asin: rawAsin } = await ctx.params;
  const asin = (rawAsin ?? "").trim().toUpperCase();
  if (!asin) return NextResponse.json({ error: "asin is required." }, { status: 400 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const admin = getSupabaseAdmin();

  // ── Watchlist facts ──────────────────────────────────────────────────
  // Primary select includes the migration-017 display columns; if that
  // errors (migration not run), fall back to the legacy column set so
  // the page still works with ASIN-only display info.
  let watchlist: WatchlistFacts | null = null;
  {
    type WRow = {
      asin: string;
      title: string;
      buy_price: number | string;
      buy_source: string;
      category: string | null;
      active: boolean;
      added_at: string;
      source_url?: string | null;
      product_title?: string | null;
      product_brand?: string | null;
      product_image_url?: string | null;
    };
    let row: WRow | null = null;
    const full = await admin
      .from("watchlist")
      .select(
        "asin, title, buy_price, buy_source, category, active, added_at, source_url, product_title, product_brand, product_image_url"
      )
      .eq("asin", asin)
      .maybeSingle();
    if (!full.error && full.data) {
      row = full.data as WRow;
    } else if (full.error) {
      const legacy = await admin
        .from("watchlist")
        .select("asin, title, buy_price, buy_source, category, active, added_at, source_url")
        .eq("asin", asin)
        .maybeSingle();
      if (!legacy.error && legacy.data) row = legacy.data as WRow;
    }
    if (row) {
      watchlist = {
        asin: row.asin,
        discoveryTitle: row.title,
        buyPrice: Number(row.buy_price),
        buySource: row.buy_source,
        category: row.category,
        active: row.active,
        addedAt: row.added_at,
        sourceUrl: row.source_url ?? null,
        productTitle: row.product_title ?? null,
        productBrand: row.product_brand ?? null,
        productImageUrl: row.product_image_url ?? null,
      };
    }
  }

  // ── Recent checks (newest first) ─────────────────────────────────────
  const { data: checkData, error: checkError } = await admin
    .from("deal_checks")
    .select(
      "id, asin, qty, buy_price, buy_source, sell_price, sell_price_source, eligibility, verdict, verdict_reasons, floor_price, net_profit, margin_pct, checked_at"
    )
    .eq("asin", asin)
    .order("checked_at", { ascending: false })
    .limit(10);
  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 503 });
  }
  const checks = (checkData ?? []) as DealCheckRow[];

  if (!watchlist && checks.length === 0) {
    return NextResponse.json(
      { error: "not_found", asin, message: `ASIN ${asin} is not on the watchlist and has no checks.` },
      { status: 404 }
    );
  }

  const latest = checks[0] ?? null;
  let deal: Deal | null = latest ? dealFromCheckRow(latest) : null;

  // ── Velocity + BSR (same enrichment as the list, single ASIN) ───────
  if (deal) {
    try {
      const { data: snapRows } = await admin
        .from("velocity_snapshots")
        .select("asin, sales_rank, category, checked_at")
        .eq("asin", asin)
        .order("checked_at", { ascending: true })
        .limit(5000);
      const series: MarketSnapshot[] = ((snapRows ?? []) as Array<{
        asin: string;
        sales_rank: number | null;
        category: string | null;
        checked_at: string;
      }>).map((r) => ({
        asin: r.asin,
        marketplace: "amazon",
        price: null,
        buyBoxPrice: null,
        offerCount: null,
        salesRank: typeof r.sales_rank === "number" ? r.sales_rank : null,
        category: r.category,
        capturedAt: r.checked_at,
      }));
      const rep = velocityReport(asin, series);
      deal.engine.velocity = {
        unitsPerDay: rep.unitsPerDay,
        confidence: rep.confidence,
        trend: rep.trend,
        snapshotCount: rep.snapshotCount,
        spanDays: rep.spanDays,
        basis: rep.basis,
      };
      const ranked = series.filter(
        (s) => typeof s.salesRank === "number" && (s.salesRank as number) > 0
      );
      if (ranked.length > 0) deal.bsr = ranked[ranked.length - 1].salesRank as number;
    } catch {
      // Velocity enrichment is observability — the detail stands without it.
    }

    // ── Catalog display info (migration 017) + one lazy backfill ──────
    if (watchlist) {
      if (watchlist.productTitle) deal.title = watchlist.productTitle;
      deal.brand = watchlist.productBrand;
      deal.imageUrl = watchlist.productImageUrl;
      if (!watchlist.productTitle) {
        try {
          const info = await backfillWatchlistProductInfo(admin, asin);
          if (info) {
            if (info.title) deal.title = info.title;
            deal.brand = info.brand;
            deal.imageUrl = info.imageUrl;
            watchlist.productTitle = info.title;
            watchlist.productBrand = info.brand;
            watchlist.productImageUrl = info.imageUrl;
          }
        } catch {
          // Best-effort display info only.
        }
      }
    }
  }

  // ── Buy Box winner observations (graceful if migration 010 absent) ──
  let buyboxRows: Array<{
    checked_at: string;
    sell_price: number | string | null;
    buybox_winner?: string | null;
  }> = [];
  try {
    const { data, error } = await admin
      .from("deal_checks")
      .select("checked_at, sell_price, buybox_winner")
      .eq("asin", asin)
      .order("checked_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    buyboxRows = (data ?? []) as typeof buyboxRows;
  } catch {
    buyboxRows = [];
  }

  // ── Approval queue entry ─────────────────────────────────────────────
  let approvalRow = null;
  try {
    const { data } = await admin
      .from("approval_queue")
      .select("status, approval_url, channel, net_per_unit, margin_pct, buy_price, sell_price, first_seen_at, last_seen_at")
      .eq("asin", asin)
      .maybeSingle();
    approvalRow = data;
  } catch {
    approvalRow = null;
  }

  const detail = buildDealDetail({
    asin,
    watchlist,
    deal,
    latestEligibility: latest ? latest.eligibility : null,
    recentCheckRows: checks,
    buyboxRows,
    approvalRow,
    latestBuySource: latest ? latest.buy_source : null,
  });

  return NextResponse.json(detail);
}
