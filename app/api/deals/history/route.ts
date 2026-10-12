import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { summarizePriceHistory } from "@/lib/engine/priceHistory";
import type { PricePoint } from "@/lib/engine/priceHistory";

// GET /api/deals/history?asin=X&days=90
// First-party price history: every scan persists sell_price per ASIN into
// deal_checks, so this is our Keepa-chart replacement — real observed prices,
// no paid data.
//
// Returns { asin, days, points, summary } where points are oldest-first and
// summary carries min/max/avg/median/current + the dealQuality label
// ("genuine dip" | "typical" | "elevated" | "insufficient data").
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

    return NextResponse.json({ asin, days, points, summary: summarizePriceHistory(points) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "History lookup failed." },
      { status: 500 }
    );
  }
}
