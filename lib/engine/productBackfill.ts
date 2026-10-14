// Lazy backfill of watchlist product display info (migration 017).
//
// Watchlist rows ingested before product_title/product_brand/
// product_image_url existed — or matched through a path that had no
// catalog record in hand — carry NULLs and render as bare ASINs in the
// UI. The scan and GET /api/deals call these helpers when they meet
// such a row: ONE Catalog Items getItem fetch per ASIN, persisted back
// onto the row, and never repeated once product_title is set (the
// hammering guard is the NULL check itself).
//
// Best-effort end to end: every failure (missing migration, SP-API not
// configured, 403, network) resolves to null and never throws, so
// display plumbing can never break a scan or the deals list.

import { getSupabaseAdmin } from "@/lib/supabase";
import { spApiConfigFromEnv, type SpApiConfig } from "@/lib/engine/eligibility";
import { getCatalogProductByAsin } from "@/lib/sourcing/match";
import type { CatalogProductInfo } from "@/lib/sourcing/catalogProductCore";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Read the stored display info for one ASIN. Returns an object (fields
 * possibly null) when the row exists, null when the row can't be read
 * (missing row, missing migration, DB hiccup). Never throws.
 */
export async function fetchWatchlistProductInfo(
  admin: SupabaseAdmin,
  asin: string
): Promise<CatalogProductInfo | null> {
  try {
    const { data, error } = await admin
      .from("watchlist")
      .select("product_title, product_brand, product_image_url")
      .eq("asin", asin)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      product_title: string | null;
      product_brand: string | null;
      product_image_url: string | null;
    };
    return {
      title: row.product_title ?? null,
      brand: row.product_brand ?? null,
      imageUrl: row.product_image_url ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the ASIN's catalog record once and persist its display info
 * onto the watchlist row. Returns the info on success; null when the
 * catalog has no title for the ASIN or anything failed. Never throws.
 */
export async function backfillWatchlistProductInfo(
  admin: SupabaseAdmin,
  asin: string,
  cfg?: SpApiConfig | null,
  fetchFn: typeof fetch = fetch
): Promise<CatalogProductInfo | null> {
  try {
    const spCfg = cfg === undefined ? spApiConfigFromEnv(process.env) : cfg;
    if (!spCfg) return null;
    const { product } = await getCatalogProductByAsin(spCfg, asin, fetchFn);
    if (!product || !product.title) return null;
    const info: CatalogProductInfo = {
      title: product.title,
      brand: product.brand,
      imageUrl: product.imageUrl,
    };
    await admin
      .from("watchlist")
      .update({
        product_title: info.title,
        product_brand: info.brand,
        product_image_url: info.imageUrl,
      })
      .eq("asin", asin);
    return info;
  } catch {
    return null;
  }
}
