import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { getFeaturedOfferExpectedPrices } from "@/lib/spapi/foep";
import {
  summarizeFoep,
  unavailableFoepResult,
  type FoepSkuResult,
} from "@/lib/spapi/foepCore";

// GET /api/listings/foep
//
// Featured Offer Expected Price (FOEP) hints for every synced AMAZON
// listing: Amazon's computed listing price at or below which our offer
// can expect to win the Featured Offer, plus the exact gap from our
// current price. ADVISORY ONLY — this route never writes a price; the
// two-step manual Apply in POST /api/listings/[id]/reprice remains the
// only way a live price changes (automatic repricing stays disabled).
//
// Auth: Clerk session OR personal API key (X-NexArb-Key) via
// resolveUser (proxy.ts bypasses this exact path).
//
// Rate discipline: Amazon's FOEP usage plan is 0.033 rps / burst 1, so
// the route makes ONE batch call (<= 40 SKUs) per cache miss and serves
// a 5-minute in-memory cache per SKU set. Honesty: a SKU Amazon gives
// no valid FOEP for comes back as state "unavailable" or
// "no-competition" with the real reason — never an invented price.

const CACHE_TTL_MS = 5 * 60 * 1000;

interface FoepCacheEntry {
  at: number;
  checkedAt: string;
  reason: string | null;
  capped: boolean;
  resultsBySku: Map<string, FoepSkuResult>;
}

// Module-level, per-instance cache keyed by the ordered unique SKU set.
// Same in-memory precedent as lib/engine/eligibility.ts's cache.
let cache: { key: string; entry: FoepCacheEntry } | null = null;

export interface FoepEntry {
  listingId: string;
  sellerSku: string;
  asin: string | null;
  ourPrice: number | null;
  state: "valid" | "no-competition" | "unavailable";
  expectedPrice: number | null;
  currency: string;
  gap: number | null;
  gapText: string | null;
  note: string;
  resultStatus: string | null;
  currentFeaturedPrice: number | null;
  competingFeaturedPrice: number | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const { data: rows, error } = await sb
      .from("listings")
      .select("id, channel, seller_sku, asin, our_price")
      .eq("channel", "amazon")
      .order("asin", { ascending: true });
    if (error) {
      return NextResponse.json(
        { error: "Could not load listings", reasons: [error.message] },
        { status: 503 }
      );
    }
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    const skus = [...new Set(list.map((r) => String(r.seller_sku)).filter(Boolean))];

    let entry: FoepCacheEntry;
    let cached = false;
    const cacheKey = skus.join("\n");
    if (cache && cache.key === cacheKey && Date.now() - cache.entry.at < CACHE_TTL_MS) {
      entry = cache.entry;
      cached = true;
    } else {
      const cfg = spApiConfigFromEnv(process.env);
      if (!cfg) {
        const reason = "SP-API not configured — Featured Offer prices unavailable.";
        entry = {
          at: Date.now(),
          checkedAt: new Date().toISOString(),
          reason,
          capped: false,
          resultsBySku: new Map(
            skus.map((sku) => [sku, unavailableFoepResult(sku, reason)])
          ),
        };
      } else if (skus.length === 0) {
        entry = {
          at: Date.now(),
          checkedAt: new Date().toISOString(),
          reason: null,
          capped: false,
          resultsBySku: new Map(),
        };
      } else {
        const outcome = await getFeaturedOfferExpectedPrices(cfg, skus);
        entry = {
          at: Date.now(),
          checkedAt: outcome.checkedAt,
          reason: outcome.reason,
          capped: outcome.capped,
          resultsBySku: new Map(outcome.results.map((r) => [r.sku, r])),
        };
        // Cache only successful batch calls; a throttled/failed attempt
        // must not hide recovery for five minutes.
        if (outcome.reason === null) {
          cache = { key: cacheKey, entry };
        }
      }
    }

    const foep: FoepEntry[] = list.map((r) => {
      const sellerSku = String(r.seller_sku);
      const ourPrice = r.our_price != null ? Number(r.our_price) : null;
      const result =
        entry.resultsBySku.get(sellerSku) ??
        unavailableFoepResult(
          sellerSku,
          entry.capped
            ? "Not checked — this SKU was beyond Amazon's 40-SKU batch cap."
            : "Amazon returned no response for this SKU in the FOEP batch."
        );
      const summary = summarizeFoep(result, ourPrice);
      return {
        listingId: String(r.id),
        sellerSku,
        asin: r.asin ? String(r.asin) : null,
        ourPrice,
        state: summary.state,
        expectedPrice: summary.expectedPrice,
        currency: summary.currency,
        gap: summary.gap,
        gapText: summary.gapText,
        note: summary.note,
        resultStatus: result.resultStatus,
        currentFeaturedPrice: result.currentFeaturedPrice,
        competingFeaturedPrice: result.competingFeaturedPrice,
      };
    });

    return NextResponse.json({
      foep,
      checkedAt: entry.checkedAt,
      cached,
      reason: entry.reason,
      capped: entry.capped,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not load Featured Offer prices",
        reasons: [e instanceof Error ? e.message : "unknown error"],
      },
      { status: 500 }
    );
  }
}
