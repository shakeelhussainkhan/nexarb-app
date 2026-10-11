import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";

export interface Deal {
  id: number;
  asin: string;
  title: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  margin: number;
  bsr: number;
  channel: string;
  confidence: string;
  verifiedPrice: boolean;
  category: string;
  timestamp: string;
}

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
      "id, asin, buy_price, buy_source, sell_price, sell_price_source, eligibility, verdict, net_profit, margin_pct, checked_at"
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
    buy_price: number | string;
    buy_source: string;
    sell_price: number | string | null;
    sell_price_source: string;
    eligibility: string;
    verdict: string;
    net_profit: number | string | null;
    margin_pct: number | string | null;
    checked_at: string;
  }>) {
    if (seen.has(row.asin)) continue;
    seen.add(row.asin);
    deals.push({
      id: row.id,
      asin: row.asin,
      title: row.asin,
      buyPrice: Number(row.buy_price),
      sellPrice: row.sell_price === null ? 0 : Number(row.sell_price),
      profit: row.net_profit === null ? 0 : Number(row.net_profit),
      margin: row.margin_pct === null ? 0 : Number(row.margin_pct),
      bsr: 0,
      channel: row.buy_source.includes("walmart") ? "Walmart" : "Manual",
      confidence:
        row.sell_price_source === "sp-api-pricing" && row.eligibility !== "UNKNOWN"
          ? "High"
          : "Low",
      verifiedPrice: row.sell_price_source === "sp-api-pricing",
      category: row.eligibility,
      timestamp: row.checked_at,
    });
  }

  return NextResponse.json({ deals });
}
