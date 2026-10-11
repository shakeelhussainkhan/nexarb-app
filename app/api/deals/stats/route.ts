import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";

export interface DealsStats {
  totalToday: number;
  pendingCount: number;
  avgMargin: number;
  estTotalProfit: number;
  channelBreakdown: {
    amazon: number;
    walmart: number;
    alibaba: number;
  };
}

const FALLBACK: DealsStats = {
  totalToday: 0,
  pendingCount: 0,
  avgMargin: 0,
  estTotalProfit: 0,
  channelBreakdown: { amazon: 0, walmart: 0, alibaba: 0 },
};

// GET /api/deals/stats — computed from first-party deal_checks + purchases.
export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json(FALLBACK, { status: 200 });
  }

  try {
    const admin = getSupabaseAdmin();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const [{ data: checks }, { data: purchases }] = await Promise.all([
      admin
        .from("deal_checks")
        .select("verdict, margin_pct, net_profit")
        .gte("checked_at", since.toISOString()),
      admin
        .from("purchases")
        .select("id")
        .eq("status", "PENDING_APPROVAL"),
    ]);

    const rows = (checks ?? []) as Array<{
      verdict: string;
      margin_pct: number | string | null;
      net_profit: number | string | null;
    }>;
    const buys = rows.filter((r) => r.verdict === "BUY");
    const margins = buys
      .map((r) => (r.margin_pct === null ? null : Number(r.margin_pct)))
      .filter((m): m is number => m !== null && Number.isFinite(m));
    const profits = buys
      .map((r) => (r.net_profit === null ? null : Number(r.net_profit)))
      .filter((p): p is number => p !== null && Number.isFinite(p));

    return NextResponse.json({
      totalToday: rows.length,
      pendingCount: (purchases ?? []).length,
      avgMargin: margins.length
        ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10
        : 0,
      estTotalProfit: Math.round(profits.reduce((a, b) => a + b, 0) * 100) / 100,
      channelBreakdown: { amazon: rows.length, walmart: 0, alibaba: 0 },
    } satisfies DealsStats);
  } catch {
    return NextResponse.json(FALLBACK, { status: 200 });
  }
}
