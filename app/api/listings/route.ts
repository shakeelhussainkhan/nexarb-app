import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { outcomeAtPrice, floorPrice } from "@/lib/engine/pricing";
import { suggestListPrice } from "@/lib/engine/repricing";
import { deriveBuyBoxState } from "@/lib/engine/listingSync";

export interface EnrichedListing {
  id: string;
  channel: "amazon" | "walmart";
  sellerSku: string;
  asin: string | null;
  title: string | null;
  ourPrice: number | null;
  buyboxPrice: number | null;
  buyboxState: "winning" | "losing" | "unknown";
  offerCount: number | null;
  lastSyncedAt: string | null;
  // Enrichment (all nullable — honest when inputs are missing):
  buyCost: number | null; // latest observed buy price from deal_checks
  netProfit: number | null; // per unit at our live price (fee-stack estimate)
  marginPct: number | null;
  suggested: number | null; // penny-under-Buy-Box suggestion
  suggestedReason: string | null;
  priceMin: number | null; // founder-approved bounds from watchlist
  priceMax: number | null;
}

// GET /api/listings — the selling cockpit's data. Reads the `listings`
// table synced by POST /api/listings/sync and enriches each row with:
//  - margin at the live price (pricing engine, needs a known buy cost)
//  - a list-price suggestion (repricing engine, penny under Buy Box)
//  - founder-approved price bounds (watchlist)
// Everything nullable rather than invented. Never throws.
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb
      .from("listings")
      .select("id, channel, seller_sku, asin, title, our_price, buybox_price, buybox_winner, offer_count, last_synced_at")
      .order("channel", { ascending: true })
      .order("asin", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "Could not load listings", reasons: [error.message] }, { status: 503 });
    }

    const list = (rows ?? []) as Array<Record<string, unknown>>;
    const asins = [...new Set(list.map((r) => r.asin as string).filter(Boolean))];

    // Latest observed buy price per ASIN (from our own deal checks).
    const buyCostByAsin = new Map<string, number>();
    if (asins.length) {
      const { data: checks } = await sb
        .from("deal_checks")
        .select("asin, buy_price, checked_at")
        .in("asin", asins)
        .order("checked_at", { ascending: false });
      for (const c of (checks ?? []) as Array<Record<string, unknown>>) {
        const asin = String(c.asin);
        if (buyCostByAsin.has(asin)) continue;
        const bp = Number(c.buy_price);
        if (bp > 0) buyCostByAsin.set(asin, bp);
      }
    }

    // Founder-approved bounds from the watchlist.
    const boundsByAsin = new Map<string, { min: number | null; max: number | null }>();
    if (asins.length) {
      const { data: wl } = await sb
        .from("watchlist")
        .select("asin, price_min, price_max")
        .in("asin", asins);
      for (const w of (wl ?? []) as Array<Record<string, unknown>>) {
        const pm = w.price_min != null ? Number(w.price_min) : null;
        const px = w.price_max != null ? Number(w.price_max) : null;
        boundsByAsin.set(String(w.asin), {
          min: pm != null && pm > 0 ? pm : null,
          max: px != null && px > 0 ? px : null,
        });
      }
    }

    const listings: EnrichedListing[] = list.map((r) => {
      const channel = (r.channel === "walmart" ? "walmart" : "amazon") as "amazon" | "walmart";
      const asin = r.asin ? String(r.asin) : null;
      const ourPrice = r.our_price != null ? Number(r.our_price) : null;
      const buyboxPrice = r.buybox_price != null ? Number(r.buybox_price) : null;
      const buyCost = asin ? (buyCostByAsin.get(asin) ?? null) : null;

      // Margin at the live price via the fee-stack engine (estimates labeled).
      let netProfit: number | null = null;
      let marginPct: number | null = null;
      if (ourPrice != null && ourPrice > 0 && buyCost != null && buyCost > 0) {
        const outcome = outcomeAtPrice(ourPrice, { buyCost });
        netProfit = Math.round(outcome.netProfit * 100) / 100;
        marginPct = Math.round(outcome.marginPct * 100) / 100;
      }

      // Suggested list price: penny under Buy Box, clamped above a
      // 20%-margin floor. Only when we have both inputs.
      let suggested: number | null = null;
      let suggestedReason: string | null = null;
      if (buyboxPrice != null && buyboxPrice > 0 && buyCost != null && buyCost > 0) {
        const floor = floorPrice({ buyCost }, 0.2);
        const s = suggestListPrice({ buyBoxPrice: buyboxPrice, floorPrice: floor, channel });
        suggested = s.suggested;
        suggestedReason = s.reasoning;
      }

      const bounds = asin ? boundsByAsin.get(asin) : undefined;

      return {
        id: String(r.id),
        channel,
        sellerSku: String(r.seller_sku),
        asin,
        title: r.title ? String(r.title) : null,
        ourPrice,
        buyboxPrice,
        buyboxState: deriveBuyBoxState(r.buybox_winner === true ? true : r.buybox_winner === false ? false : null),
        offerCount: r.offer_count != null ? Number(r.offer_count) : null,
        lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : null,
        buyCost,
        netProfit,
        marginPct,
        suggested,
        suggestedReason,
        priceMin: bounds?.min ?? null,
        priceMax: bounds?.max ?? null,
      };
    });

    return NextResponse.json({ listings });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not load listings", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 500 }
    );
  }
}
