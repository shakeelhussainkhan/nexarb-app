import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { assessTrust } from "@/lib/engine/trust";

export interface DealEngine {
  verdict: "BUY" | "SKIP" | "UNKNOWN";
  reasons: string[];
  floorPrice: number;
  realisticPrice: number;
  netProfitAtRealistic: number;
  marginAtRealistic: number;
  estMonthlySales: number;
  velocityBasis: string;
  velocityConfidence: string;
  daysToClear: number | null;
  suggestedQty: number;
  // Multi-channel breakdown. deal_checks stores only the chosen/lead
  // channel's numbers (no channels column — migrations out of scope), so
  // this is the honest minimum reconstructed from the row: the priced
  // channel carries the row's numbers; the Walmart channel is unavailable
  // until a real competitive-pricing endpoint exists (lib/walmart/pricing.ts).
  channels: DealChannel[];
  chosenChannel: "amazon-fba" | "walmart-wfs" | null;
}

export interface DealChannel {
  channel: "amazon-fba" | "walmart-wfs";
  sellPrice: number | null;
  sellPriceSource: string;
  netProfit: number;
  marginPct: number;
  verdict: "BUY" | "SKIP" | "UNKNOWN";
}

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
  trust: { level: "verified-retailer" | "unverified"; notes: string[] };
  engine: DealEngine;
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
    const sellPrice = row.sell_price === null ? 0 : Number(row.sell_price);
    const netProfit = row.net_profit === null ? 0 : Number(row.net_profit);
    const margin = row.margin_pct === null ? 0 : Number(row.margin_pct);
    const floorPrice = row.floor_price === null ? 0 : Number(row.floor_price);
    const verdict =
      row.verdict === "BUY" || row.verdict === "SKIP" ? row.verdict : "UNKNOWN";
    // Reconstruct the per-channel breakdown from the chosen-channel row.
    // Only "sp-api-pricing" rows carry a real priced channel today; anything
    // else means no channel had price data. chosenChannel is set only for
    // BUY rows (pre-channels rows were all Amazon).
    const amazonPriced = row.sell_price_source === "sp-api-pricing";
    const walmartPriced =
      !amazonPriced && row.sell_price_source.startsWith("walmart");
    const amazonChannel: DealChannel = amazonPriced
      ? {
          channel: "amazon-fba",
          sellPrice,
          sellPriceSource: row.sell_price_source,
          netProfit,
          marginPct: margin,
          // Aggregate verdict == channel verdict when a single channel
          // carried price data (velocity-UNKNOWN folds into aggregate SKIP).
          verdict,
        }
      : {
          channel: "amazon-fba",
          sellPrice: null,
          sellPriceSource: row.sell_price_source,
          netProfit: 0,
          marginPct: 0,
          verdict: "UNKNOWN",
        };
    const walmartChannel: DealChannel = walmartPriced
      ? {
          channel: "walmart-wfs",
          sellPrice,
          sellPriceSource: row.sell_price_source,
          netProfit,
          marginPct: margin,
          verdict,
        }
      : {
          channel: "walmart-wfs",
          sellPrice: null,
          // The seller API exposes no competitive pricing (lib/walmart/pricing.ts).
          sellPriceSource: "unavailable",
          netProfit: 0,
          marginPct: 0,
          verdict: "UNKNOWN",
        };
    let chosenChannel: DealEngine["chosenChannel"] = null;
    if (verdict === "BUY") {
      if (amazonPriced) chosenChannel = "amazon-fba";
      else if (walmartPriced) chosenChannel = "walmart-wfs";
    }
    deals.push({
      id: row.id,
      asin: row.asin,
      title: row.asin,
      buyPrice: Number(row.buy_price),
      sellPrice,
      profit: netProfit,
      margin,
      bsr: 0,
      channel: row.buy_source.includes("walmart") ? "Walmart" : "Manual",
      trust: assessTrust(row.buy_source),
      confidence:
        row.sell_price_source === "sp-api-pricing" && row.eligibility !== "UNKNOWN"
          ? "High"
          : "Low",
      verifiedPrice: row.sell_price_source === "sp-api-pricing",
      category: row.eligibility,
      timestamp: row.checked_at,
      engine: {
        verdict: verdict as "BUY" | "SKIP" | "UNKNOWN",
        reasons: row.verdict_reasons ?? [],
        floorPrice,
        realisticPrice: sellPrice,
        netProfitAtRealistic: netProfit,
        marginAtRealistic: margin,
        estMonthlySales: 0,
        velocityBasis: "unavailable",
        velocityConfidence: "low",
        daysToClear: null,
        suggestedQty: row.qty ?? 10,
        channels: [amazonChannel, walmartChannel],
        chosenChannel,
      },
    });
  }

  return NextResponse.json(deals);
}
