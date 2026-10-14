import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { retailerAdapters } from "@/lib/sourcing/adapters";
import type { SourcedCandidate } from "@/lib/sourcing/types";
import { matchUpcToAsin, createTokenCache } from "@/lib/sourcing/match";
import { SpApiThrottle } from "@/lib/sourcing/throttle";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import {
  buildWatchlistPayload,
  MAX_NEW_WATCHLIST_ROWS,
} from "@/lib/sourcing/orchestrate";
import type { UpcMatch } from "@/lib/sourcing/orchestrate";

// POST /api/sourcing/sweep
// Deal-discovery sweeper: sweeps every registered retailer adapter
// (Walmart, Costco, …) for candidate products, extracts UPCs, matches each
// UPC to an Amazon ASIN via SP-API, and inserts NEW matches into `watchlist`
// as candidates for the verification engine.
// The dashboard's "Run scan now" then verifies them like any other watchlist
// item.
//
// NOTE: retailer sites heavily bot-protect datacenter IPs, so server-side
// adapter sweeps are frequently blocked (reported in `errors`). The live
// discovery path is the browser session posting to /api/sourcing/discover.
//
// UPC->ASIN matching runs sequentially through a shared SP-API throttle
// (min ~3s between calls ≈ 20 req/min, exponential backoff on 429s) with
// one LWA token per run. Expected: up to 100 lookups ≈ 5-6 min of matching.
// Sequential + paced is deliberate — SP-API is rate-limited and hammering
// it would fail the run.
//
// DISCOVERY ONLY — nothing here purchases, creates intents, or spends money.
// The handler never throws: every failure path returns JSON.
export async function POST(): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { success: false, error: "Supabase is not configured — nowhere to store discovery results." },
        { status: 503 }
      );
    }

    const errors: string[] = [];

    // 1. Sweep every registered retailer (each adapter sweep never throws;
    // belt-and-braces anyway).
    const allItems: SourcedCandidate[] = [];
    for (const adapter of retailerAdapters) {
      try {
        const out = await adapter.sweep({ maxItems: 100, maxUpcFetches: 100 });
        for (const e of out.errors) errors.push(`[${adapter.slug}] ${e}`);
        allItems.push(...out.items);
      } catch (e) {
        errors.push(
          `[${adapter.slug}] sweep failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // 2. Match each distinct non-null UPC to an Amazon ASIN via SP-API.
    // Paced + retried through the shared throttle; one LWA token per run.
    const spApiCfg = spApiConfigFromEnv(process.env);
    const throttle = new SpApiThrottle();
    const tokenCache = createTokenCache();
    const spFetch: typeof fetch = (input, init) => throttle.fetch(input, init, fetch);

    const byUpc = new Map<string, SourcedCandidate>();
    for (const item of allItems) {
      if (item.upc && !byUpc.has(item.upc)) byUpc.set(item.upc, item);
    }

    const matchesByRetailer = new Map<string, UpcMatch[]>();
    let matched = 0;
    for (const [upc, item] of byUpc) {
      try {
        const { match, reason } = await matchUpcToAsin(spApiCfg, upc, spFetch, {
          tokenCache,
        });
        if (match) {
          matched++;
          const list = matchesByRetailer.get(item.retailer) ?? [];
          list.push({
            asin: match.asin,
            title: match.title,
            brand: match.brand,
            imageUrl: match.imageUrl,
            buyPrice: item.price,
            sourceUrl: item.url,
          });
          matchesByRetailer.set(item.retailer, list);
        } else if (reason) {
          errors.push(`[${item.retailer}] UPC ${upc}: ${reason}`);
        }
      } catch (e) {
        errors.push(
          `[${item.retailer}] UPC ${upc}: match failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // 3. Insert NEW matches only: check existing ASINs first, cap the run at
    // MAX_NEW_WATCHLIST_ROWS new rows shared across retailers, on conflict
    // do nothing.
    const admin = getSupabaseAdmin();
    const allAsins = [...matchesByRetailer.values()]
      .flat()
      .map((m) => m.asin);
    const existing = new Set<string>();
    if (allAsins.length > 0) {
      const { data, error } = await admin
        .from("watchlist")
        .select("asin")
        .in("asin", allAsins);
      if (error) {
        return NextResponse.json(
          { success: false, error: `Could not read watchlist: ${error.message}` },
          { status: 503 }
        );
      }
      for (const r of (data ?? []) as Array<{ asin: string }>) {
        existing.add(r.asin);
      }
    }

    let added = 0;
    let remaining = MAX_NEW_WATCHLIST_ROWS;
    const byRetailer: Record<string, number> = {};
    for (const [retailer, matches] of matchesByRetailer) {
      if (remaining <= 0) break;
      const rows = buildWatchlistPayload(matches, existing, {
        maxNew: remaining,
        buySource: `${retailer}-clearance`,
      });
      if (rows.length > 0) {
        const { error } = await admin
          .from("watchlist")
          .upsert(rows, { onConflict: "asin", ignoreDuplicates: true });
        if (error) {
          return NextResponse.json(
            { success: false, error: `Could not write watchlist: ${error.message}` },
            { status: 503 }
          );
        }
        added += rows.length;
        remaining -= rows.length;
        byRetailer[retailer] = rows.length;
        for (const r of rows) existing.add(r.asin);
      }
    }

    return NextResponse.json({
      success: true,
      swept: allItems.length,
      matched,
      added,
      byRetailer,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Discovery sweep failed." },
      { status: 500 }
    );
  }
}
