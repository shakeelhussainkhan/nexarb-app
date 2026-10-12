import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { summarizePriceHistory } from "@/lib/engine/priceHistory";
import type { PricePoint } from "@/lib/engine/priceHistory";

// GET /api/deals/history?asin=X&days=90[&include=buybox]
// First-party price history: every scan persists sell_price per ASIN into
// deal_checks, so this is our Keepa-chart replacement — real observed prices,
// no paid data.
//
// Returns { asin, days, points, summary } where points are oldest-first and
// summary carries min/max/avg/median/current + the dealQuality label
// ("genuine dip" | "typical" | "elevated" | "insufficient data").
// With ?include=buybox, also returns buybox: [{ checkedAt, sellPrice, winner }]
// oldest-first, where winner is "us" | "competitor" | "unknown". The buybox
// query runs separately with a graceful fallback: if migration 010 hasn't been
// run yet, every observation reports "unknown" instead of breaking the
// existing price-history response.
// Clerk-gated. Never throws: every failure path returns JSON.
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    }

    const url = new URL(req.url);
    const asin = (url.searchParams.get("asin") ?? "").trim();
    if (!asin) {
      return NextResponse.json({ error: "asin is required." }, { status: 400 });
    }
    let days = Number(url.searchParams.get("days") ?? "90");
    if (!Number.isFinite(days)) days = 90;
    days = Math.min(365, Math.max(1, Math.floor(days)));

    const admin = getSupabaseAdmin();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await admin
      .from("deal_checks")
      .select("checked_at, sell_price, buy_price, verdict")
      .eq("asin", asin)
      .gte("checked_at", since)
      .order("checked_at", { ascending: true })
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const points: PricePoint[] = (
      (data ?? []) as Array<{
        checked_at: string;
        sell_price: number | string | null;
        buy_price: number | string;
        verdict: string;
      }>
    )
      .filter((r) => r.sell_price !== null && Number.isFinite(Number(r.sell_price)))
      .map((r) => ({
        checkedAt: r.checked_at,
        sellPrice: Number(r.sell_price),
        buyPrice: Number(r.buy_price),
        verdict: r.verdict,
      }));

    return NextResponse.json({ asin, days, points, summary: summarizePriceHistory(points), ...(await buyboxPayload(asin)) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "History lookup failed." },
      { status: 500 }
    );
  }

  // Separate buybox query with graceful fallback: if migration 010 hasn't run,
  // the column doesn't exist and we report "unknown" for every observation
  // rather than breaking the price-history response.
  async function buyboxPayload(forAsin: string): Promise<{ buybox?: Array<{ checkedAt: string; sellPrice: number | null; winner: "us" | "competitor" | "unknown" }> }> {
    const url = new URL(req.url);
    if (url.searchParams.get("include") !== "buybox") return {};
    const daysParam = Number(url.searchParams.get("days") ?? "90");
    const d = Number.isFinite(daysParam) ? Math.min(365, Math.max(1, Math.floor(daysParam))) : 90;
    try {
      const admin = getSupabaseAdmin();
      const since = new Date(Date.now() - d * 86400000).toISOString();
      const { data, error } = await admin
        .from("deal_checks")
        .select("checked_at, sell_price, buybox_winner")
        .eq("asin", forAsin)
        .gte("checked_at", since)
        .order("checked_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        checked_at: string;
        sell_price: number | string | null;
        buybox_winner: string | null;
      }>;
      return {
        buybox: rows.map((r) => ({
          checkedAt: r.checked_at,
          sellPrice: r.sell_price === null ? null : Number(r.sell_price),
          winner: (r.buybox_winner === "us" || r.buybox_winner === "competitor" ? r.buybox_winner : "unknown") as "us" | "competitor" | "unknown",
        })),
      };
    } catch {
      return { buybox: [] };
    }
  }
}
