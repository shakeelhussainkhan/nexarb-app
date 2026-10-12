import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sweepWalmartClearance } from "@/lib/sourcing/walmart";
import type { SourcedProduct } from "@/lib/sourcing/walmart";
import { matchUpcToAsin } from "@/lib/sourcing/match";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { buildWatchlistPayload } from "@/lib/sourcing/orchestrate";
import type { UpcMatch } from "@/lib/sourcing/orchestrate";

// POST /api/sourcing/sweep
// Deal-discovery sweeper: sweeps Walmart clearance for candidate products,
// extracts UPCs, matches each UPC to an Amazon ASIN via SP-API, and inserts
// NEW matches into `watchlist` as candidates for the verification engine.
// The dashboard's "Run scan now" then verifies them like any other watchlist
// item.
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

    // 1. Sweep Walmart clearance (contract: never throws; belt-and-braces anyway).
    let items: SourcedProduct[] = [];
    try {
      const swept = await sweepWalmartClearance({ maxItems: 50, maxUpcFetches: 25 });
      items = swept.items;
      errors.push(...swept.errors);
    } catch (e) {
      errors.push(`sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Match each distinct non-null UPC to an Amazon ASIN via SP-API.
    // Sequential: kinder to SP-API rate limits, and each lookup never throws.
    const spApiCfg = spApiConfigFromEnv(process.env);
    const byUpc = new Map<string, SourcedProduct>();
    for (const item of items) {
      if (item.upc && !byUpc.has(item.upc)) byUpc.set(item.upc, item);
    }

    const matches: UpcMatch[] = [];
    for (const [upc, item] of byUpc) {
      try {
        const { match, reason } = await matchUpcToAsin(spApiCfg, upc);
        if (match) {
          matches.push({ asin: match.asin, title: match.title, buyPrice: item.price, sourceUrl: item.url });
        } else if (reason) {
          errors.push(`UPC ${upc}: ${reason}`);
        }
      } catch (e) {
        errors.push(`UPC ${upc}: match failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Insert NEW matches only: check existing ASINs first, cap at 25 new
    // rows per run, on conflict do nothing.
    const admin = getSupabaseAdmin();
    const asins = matches.map((m) => m.asin);
    let existing: string[] = [];
    if (asins.length > 0) {
      const { data, error } = await admin.from("watchlist").select("asin").in("asin", asins);
      if (error) {
        return NextResponse.json(
          { success: false, error: `Could not read watchlist: ${error.message}` },
          { status: 503 }
        );
      }
      existing = ((data ?? []) as Array<{ asin: string }>).map((r) => r.asin);
    }

    const rows = buildWatchlistPayload(matches, existing);
    let added = 0;
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
      added = rows.length;
    }

    return NextResponse.json({
      success: true,
      swept: items.length,
      matched: matches.length,
      added,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Discovery sweep failed." },
      { status: 500 }
    );
  }
}
