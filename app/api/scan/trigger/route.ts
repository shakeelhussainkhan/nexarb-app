import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runDealCheck, persistDealCheck } from "@/lib/engine/dealcheck";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";

// POST /api/scan/trigger
// First-party scan: runs every active watchlist item through the full
// deal-check pipeline (live sell price + live eligibility + engine verdict +
// guard dry-run) and persists each trace to deal_checks. The dashboard reads
// deal_checks, so results appear immediately — no dead relay involved.
export async function POST(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json(
      { success: false, error: "Supabase is not configured — nowhere to store scan results." },
      { status: 503 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: items, error } = await admin
    .from("watchlist")
    .select("asin, buy_price, category")
    .eq("active", true)
    .order("added_at", { ascending: true })
    .limit(25);

  if (error) {
    return NextResponse.json(
      { success: false, error: `Could not read watchlist: ${error.message}` },
      { status: 503 }
    );
  }

  const list = (items ?? []) as Array<{ asin: string; buy_price: number | string; category: string | null }>;
  if (list.length === 0) {
    return NextResponse.json({
      success: true,
      message: "Watchlist is empty — add ASINs to scan.",
      checked: 0,
      results: [],
    });
  }

  const results: Array<{
    asin: string;
    verdict: string;
    eligibility: string;
    sellPrice: number | null;
    wouldCreateIntent: boolean;
  }> = [];

  for (const item of list) {
    try {
      const trace = await runDealCheck(
        item.asin,
        Number(item.buy_price),
        10,
        item.category ?? undefined
      );
      await persistDealCheck(trace, userId);
      results.push({
        asin: trace.asin,
        verdict: trace.verdict.state,
        eligibility: trace.eligibility.state,
        sellPrice: trace.inputs.sellPrice.value,
        wouldCreateIntent: trace.guards.wouldCreateIntent,
      });
    } catch {
      results.push({
        asin: item.asin,
        verdict: "UNKNOWN",
        eligibility: "UNKNOWN",
        sellPrice: null,
        wouldCreateIntent: false,
      });
    }
  }

  const buys = results.filter((r) => r.verdict === "BUY").length;
  return NextResponse.json({
    success: true,
    message: `Scan complete: ${results.length} checked, ${buys} BUY.`,
    checked: results.length,
    buys,
    results,
  });
}
