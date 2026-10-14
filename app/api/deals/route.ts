import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { velocityReport, type VelocityReport } from "@/lib/engine/velocity";
import { dealFromCheckRow, type Deal } from "@/lib/engine/dealCore";
import {
  fetchWatchlistProductInfo,
  backfillWatchlistProductInfo,
} from "@/lib/engine/productBackfill";
import type { MarketSnapshot } from "@/lib/data/types";

// The Deal shapes live in lib/engine/dealCore.ts (shared with the
// per-ASIN detail route); re-exported here for existing importers.
export type { Deal, DealEngine, DealChannel } from "@/lib/engine/dealCore";

// GET /api/deals — first-party deal list.
// Returns the latest deal_checks row per ASIN (newest first), mapped to the
// dashboard's Deal shape. No relay involved.
export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ deals: [], note: "Supabase not configured." });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("deal_checks")
    .select(
      "id, asin, qty, buy_price, buy_source, sell_price, sell_price_source, eligibility, verdict, verdict_reasons, floor_price, net_profit, margin_pct, checked_at"
    )
    .order("checked_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ deals: [], error: error.message }, { status: 503 });
  }

  // Latest check per ASIN.
  const seen = new Set<string>();
  const deals: Deal[] = [];
  for (const row of (data ?? []) as Array<{
    id: number;
    asin: string;
    qty: number;
    buy_price: number | string;
    buy_source: string;
    sell_price: number | string | null;
    sell_price_source: string;
    eligibility: string;
    verdict: string;
    verdict_reasons: string[] | null;
    floor_price: number | string | null;
    net_profit: number | string | null;
    margin_pct: number | string | null;
    checked_at: string;
  }>) {
    if (seen.has(row.asin)) continue;
    seen.add(row.asin);
    deals.push(dealFromCheckRow(row));
  }

  // First-party velocity: one batched read of the velocity_snapshots series
  // for every ASIN on this page, then velocityReport() per ASIN. Best-effort —
  // any failure leaves the "insufficient data" placeholders above intact and
  // never breaks the deals list.
  try {
    const asins = deals.map((d) => d.asin);
    if (asins.length > 0) {
      const { data: snapRows } = await admin
        .from("velocity_snapshots")
        .select("asin, sales_rank, category, checked_at")
        .in("asin", asins)
        .order("checked_at", { ascending: true })
        .limit(5000);
      const byAsin = new Map<string, MarketSnapshot[]>();
      for (const r of (snapRows ?? []) as Array<{
        asin: string;
        sales_rank: number | null;
        category: string | null;
        checked_at: string;
      }>) {
        const arr = byAsin.get(r.asin) ?? [];
        arr.push({
          asin: r.asin,
          marketplace: "amazon",
          price: null,
          buyBoxPrice: null,
          offerCount: null,
          salesRank: typeof r.sales_rank === "number" ? r.sales_rank : null,
          category: r.category,
          capturedAt: r.checked_at,
        });
        byAsin.set(r.asin, arr);
      }
      for (const d of deals) {
        const series = byAsin.get(d.asin) ?? [];
        const rep: VelocityReport = velocityReport(d.asin, series);
        d.engine.velocity = {
          unitsPerDay: rep.unitsPerDay,
          confidence: rep.confidence,
          trend: rep.trend,
          snapshotCount: rep.snapshotCount,
          spanDays: rep.spanDays,
          basis: rep.basis,
        };
        // The deals table has no BSR column of its own; the latest ranked
        // snapshot is the honest BSR for the page (series is ascending).
        const ranked = series.filter(
          (s) => typeof s.salesRank === "number" && (s.salesRank as number) > 0
        );
        if (ranked.length > 0) d.bsr = ranked[ranked.length - 1].salesRank as number;
      }
    }
  } catch {
    // Velocity enrichment is observability — the deals list stands without it.
  }

  // Product display info (migration 017): replace the bare-ASIN title
  // with the watchlist row's catalog title/brand/image. Rows still
  // missing a title get a lazy backfill — one catalog fetch per ASIN,
  // capped per request so the page never waits on a long SP-API tail;
  // the rest backfill on later loads/scans. Best-effort, like velocity:
  // a missing migration or SP-API failure leaves titles as ASINs.
  try {
    const asins = deals.map((d) => d.asin);
    if (asins.length > 0) {
      const { data: wRows } = await admin
        .from("watchlist")
        .select("asin, product_title, product_brand, product_image_url")
        .in("asin", asins);
      const byAsin = new Map<
        string,
        { title: string | null; brand: string | null; imageUrl: string | null }
      >();
      for (const r of (wRows ?? []) as Array<{
        asin: string;
        product_title: string | null;
        product_brand: string | null;
        product_image_url: string | null;
      }>) {
        byAsin.set(r.asin, {
          title: r.product_title,
          brand: r.product_brand,
          imageUrl: r.product_image_url,
        });
      }
      const applyInfo = (
        d: Deal,
        info: { title: string | null; brand: string | null; imageUrl: string | null }
      ) => {
        if (info.title) d.title = info.title;
        d.brand = info.brand;
        d.imageUrl = info.imageUrl;
      };
      for (const d of deals) {
        const info = byAsin.get(d.asin);
        if (info) applyInfo(d, info);
      }
      const BACKFILL_MAX_PER_REQUEST = 3;
      let backfilled = 0;
      for (const d of deals) {
        if (backfilled >= BACKFILL_MAX_PER_REQUEST) break;
        const stored = byAsin.get(d.asin);
        if (!stored || stored.title !== null) continue;
        // Confirm the row really is title-less, then fetch + persist.
        const current = await fetchWatchlistProductInfo(admin, d.asin);
        if (!current || current.title !== null) continue;
        const info = await backfillWatchlistProductInfo(admin, d.asin);
        backfilled++;
        if (info) applyInfo(d, info);
      }
    }
  } catch {
    // Display enrichment is observability — the deals list stands without it.
  }

  return NextResponse.json(deals);
}
