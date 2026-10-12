import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import {
  getMyListings,
  getListingOffersSnapshot,
  type SpApiListing,
} from "@/lib/spapi/listings";
import { getWalmartItems } from "@/lib/walmart/listings";
import { walmartConfigFromEnv } from "@/lib/walmart/client";
import {
  dedupForUpsert,
  type SyncedListingRow,
} from "@/lib/engine/listingSync";

// POST /api/listings/sync
// Pull the seller's live listings from Amazon (+Walmart) and upsert them
// into the `listings` table.
//
// Amazon: Listings Items search (needs the SP-API "listings" role) gives
// seller_sku + ASIN; then the offers snapshot per SKU gives our live price,
// Buy Box price/winner, and offer count.
// Walmart: Items API gives the seller's own SKUs + prices. Walmart exposes
// NO competitive Buy Box endpoint (established 2026-10-11 investigation) —
// buybox fields stay null rather than invented.
//
// Amazon price observations are also appended to price_monitor (existing
// table) for the repricing charts. Never throws: every failure path lands
// in `errors` and returns 200 with counts.
export async function POST(_req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = getSupabaseAdmin();
    const synced: Record<string, number> = { amazon: 0, walmart: 0 };
    const errors: string[] = [];

    // --- Amazon ------------------------------------------------------------
    const spApiCfg = spApiConfigFromEnv(process.env);
    if (!spApiCfg) {
      errors.push("amazon: SP-API not configured — set AMAZON_SPAPI_REFRESH_TOKEN, AMAZON_SPAPI_CLIENT_ID, AMAZON_SPAPI_CLIENT_SECRET, AMAZON_SELLER_ID.");
    } else {
      const listingsRes = await getMyListings(spApiCfg);
      if (!listingsRes.ok) {
        errors.push(`amazon: ${listingsRes.reason}`);
      } else {
        const rows: SyncedListingRow[] = [];
        const seen = new Set<string>();
        const all: SpApiListing[] = [...listingsRes.listings];
        // First page only (bounded) — getMyListings exposes nextToken for
        // future pagination; a seller catalog sync stays small.
        for (const listing of all.slice(0, 100)) {
          if (seen.has(listing.sellerSku)) continue;
          seen.add(listing.sellerSku);
          const snap = await getListingOffersSnapshot(spApiCfg, listing.sellerSku);
          if (snap.ok) {
            rows.push({
              channel: "amazon",
              sellerSku: listing.sellerSku,
              asin: listing.asin,
              title: listing.title,
              ourPrice: snap.snapshot.ourPrice,
              buyboxPrice: snap.snapshot.buyboxPrice,
              buyboxWinner: snap.snapshot.buyboxWinnerIsOurs,
              offerCount: snap.snapshot.offerCount,
            });
          } else {
            rows.push({
              channel: "amazon",
              sellerSku: listing.sellerSku,
              asin: listing.asin,
              title: listing.title,
              ourPrice: null,
              buyboxPrice: null,
              buyboxWinner: null,
              offerCount: null,
            });
            errors.push(`amazon ${listing.sellerSku}: offers snapshot failed — ${snap.reason}`);
          }
        }
        const deduped = dedupForUpsert(rows);
        if (deduped.length) {
          const now = new Date().toISOString();
          const { error } = await sb.from("listings").upsert(
            deduped.map((r) => ({
              channel: r.channel,
              seller_sku: r.sellerSku,
              asin: r.asin,
              title: r.title,
              our_price: r.ourPrice,
              buybox_price: r.buyboxPrice,
              buybox_winner: r.buyboxWinner,
              offer_count: r.offerCount,
              last_synced_at: now,
              updated_at: now,
            })),
            { onConflict: "channel,seller_sku" }
          );
          if (error) {
            errors.push(`amazon: upsert failed — ${error.message}`);
          } else {
            synced.amazon = deduped.length;
            // Feed the price monitor (existing table) with the same observations.
            try {
              await sb.from("price_monitor").insert(
                deduped
                  .filter((r) => r.ourPrice != null || r.buyboxPrice != null)
                  .map((r) => ({
                    asin: r.asin,
                    channel: "amazon",
                    our_price: r.ourPrice,
                    buy_box_price: r.buyboxPrice,
                    checked_at: now,
                  }))
              );
            } catch {
              // Observability only — the sync already succeeded.
            }
          }
        }
      }
    }

    // --- Walmart -----------------------------------------------------------
    const walmartCfg = walmartConfigFromEnv(process.env);
    if (!walmartCfg) {
      errors.push("walmart: Walmart API not configured — set WALMART_API_CLIENT_ID and WALMART_API_CLIENT_SECRET.");
    } else {
      const itemsRes = await getWalmartItems(walmartCfg);
      if (!itemsRes.ok) {
        errors.push(`walmart: ${itemsRes.reason}`);
      } else {
        const rows: SyncedListingRow[] = itemsRes.items.map((it) => ({
          channel: "walmart" as const,
          sellerSku: it.sku,
          asin: null,
          title: it.productName,
          ourPrice: it.price,
          buyboxPrice: null, // Walmart seller API has no competitive Buy Box endpoint
          buyboxWinner: null,
          offerCount: null,
        }));
        const deduped = dedupForUpsert(rows);
        if (deduped.length) {
          const now = new Date().toISOString();
          const { error } = await sb.from("listings").upsert(
            deduped.map((r) => ({
              channel: r.channel,
              seller_sku: r.sellerSku,
              asin: r.asin,
              title: r.title,
              our_price: r.ourPrice,
              buybox_price: null,
              buybox_winner: null,
              offer_count: null,
              last_synced_at: now,
              updated_at: now,
            })),
            { onConflict: "channel,seller_sku" }
          );
          if (error) {
            errors.push(`walmart: upsert failed — ${error.message}`);
          } else {
            synced.walmart = deduped.length;
          }
        }
      }
    }

    return NextResponse.json({ synced, errors, syncedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { synced: { amazon: 0, walmart: 0 }, errors: [`Sync failed: ${e instanceof Error ? e.message : "unknown error"}`] },
      { status: 500 }
    );
  }
}
