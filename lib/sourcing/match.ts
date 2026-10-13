// UPC/EAN -> ASIN matcher for the deal-discovery sweeper.
//
// Given a UPC/EAN from a discovered Walmart product, resolves the matching
// Amazon ASIN via the SP-API Catalog Items API (v2022-04-01) so the existing
// engine (eligibility, pricing, guards) can verify the deal.
//
// IMPORTANT: the production SP-API app currently holds only the Product
// Listing role; Catalog Items may answer 403. Non-200 responses resolve to
// { match: null, reason } — never thrown. Callers doing bulk lookups should
// pass a throttled fetch (lib/sourcing/throttle.ts) so 429s back off with
// retries instead of failing the run.
//
// This module only looks up catalog data. It never creates offers,
// never purchases, never modifies anything.

import type { SpApiConfig } from "@/lib/engine/eligibility";
import {
  createTokenCache,
  getCachedAccessToken,
  type TokenCache,
} from "./throttle";
import {
  buildKeywordQuery,
  pickTitleMatch,
  type CatalogTitleItem,
} from "./titleMatchCore";

type FetchFn = typeof fetch;

export interface AsinMatch {
  asin: string;
  title: string;
  reason: string;
}

export interface MatchOutcome {
  match: AsinMatch | null;
  reason: string;
}

/** Optional per-run tuning for matchUpcToAsin. */
export interface MatchOptions {
  /**
   * Shared LWA token cache for the run. When provided, the access token is
   * fetched once and reused across lookups (100 lookups = 1 token exchange).
   * When omitted, the previous per-call exchange behavior is kept.
   */
  tokenCache?: TokenCache;
}

export { createTokenCache, type TokenCache };

async function getAccessToken(
  cfg: SpApiConfig,
  fetchFn: FetchFn,
  tokenCache?: TokenCache
): Promise<string> {
  if (tokenCache) return getCachedAccessToken(cfg, fetchFn, tokenCache);
  const res = await fetchFn("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`LWA token exchange ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("LWA token exchange returned no access token");
  return data.access_token;
}

interface CatalogItem {
  asin?: string;
  summaries?: Array<{ itemName?: string }>;
}

/**
 * Pure extraction: pull the first item with an ASIN out of a Catalog Items
 * v2022-04-01 searchByIdentifiers response body. Returns null when no item
 * carries an ASIN. Never throws.
 */
export function pickBestAsin(payload: unknown): AsinMatch | null {
  try {
    const items = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return null;
    for (const raw of items) {
      const item = raw as CatalogItem | null;
      const asin = typeof item?.asin === "string" ? item.asin.trim() : "";
      if (!asin) continue;
      const title =
        typeof item?.summaries?.[0]?.itemName === "string"
          ? item.summaries[0].itemName
          : "";
      return {
        asin,
        title,
        reason: `UPC matched ASIN ${asin} via SP-API Catalog Items.`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Strip non-digits; accept UPC/EAN lengths 8, 12, 13, 14. Null when invalid. */
function normalizeUpc(upc: string): string | null {
  if (typeof upc !== "string") return null;
  const digits = upc.replace(/\D/g, "");
  return digits.length === 8 ||
    digits.length === 12 ||
    digits.length === 13 ||
    digits.length === 14
    ? digits
    : null;
}

/**
 * Resolve a UPC/EAN to an Amazon ASIN. Never throws: every failure mode
 * (null config, invalid UPC, non-200, network error) resolves to
 * { match: null, reason }.
 */
export async function matchUpcToAsin(
  cfg: import("@/lib/engine/eligibility").SpApiConfig | null,
  upc: string,
  fetchFn: FetchFn = fetch,
  opts?: MatchOptions
): Promise<MatchOutcome> {
  if (!cfg) {
    return { match: null, reason: "SP-API not configured" };
  }
  const normalized = normalizeUpc(upc);
  if (!normalized) {
    return { match: null, reason: "invalid UPC format" };
  }
  try {
    const token = await getAccessToken(cfg, fetchFn, opts?.tokenCache);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/catalog/2022-04-01/items` +
      `?marketplaceIds=${encodeURIComponent(cfg.marketplaceId)}` +
      `&identifiersType=UPC&identifiers=${encodeURIComponent(normalized)}`;
    const res = await fetchFn(url, {
      headers: {
        "x-amz-access-token": token,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        match: null,
        reason:
          `Catalog Items lookup returned ${res.status}` +
          (body ? ` — ${body.slice(0, 200)}` : "") +
          " — no ASIN matched.",
      };
    }
    const data = await res.json();
    const match = pickBestAsin(data);
    if (!match) {
      return { match: null, reason: "No catalog item found for this UPC." };
    }
    return { match, reason: match.reason };
  } catch (e) {
    return {
      match: null,
      reason: `Catalog Items lookup failed (${e instanceof Error ? e.message : "unknown error"}) — no ASIN matched.`,
    };
  }
}

interface CatalogTitleRaw {
  asin?: string;
  summaries?: Array<{ itemName?: string; brand?: string; manufacturer?: string }>;
}

/**
 * Pure extraction: pull {asin, title, brand} triples out of a Catalog
 * Items v2022-04-01 keyword-search response. Never throws.
 */
export function parseCatalogTitleItems(payload: unknown): CatalogTitleItem[] {
  try {
    const items = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return [];
    const out: CatalogTitleItem[] = [];
    for (const raw of items) {
      const item = raw as CatalogTitleRaw | null;
      const asin = typeof item?.asin === "string" ? item.asin.trim() : "";
      const s = item?.summaries?.[0];
      const title = typeof s?.itemName === "string" ? s.itemName : "";
      if (!asin || !title) continue;
      const brand =
        (typeof s?.brand === "string" && s.brand.trim()) ||
        (typeof s?.manufacturer === "string" && s.manufacturer.trim()) ||
        null;
      out.push({ asin, title, brand });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Resolve a retailer product TITLE to an Amazon ASIN via a Catalog Items
 * keyword search, scored by the strict title-match core (brand gate,
 * exact pack/size numeric equality, similarity floor, ambiguity margin).
 * Used as the fallback for discovery candidates whose pages expose no
 * UPC. Never throws: every failure mode resolves to { match: null }.
 */
export async function matchTitleToAsin(
  cfg: import("@/lib/engine/eligibility").SpApiConfig | null,
  title: string,
  fetchFn: FetchFn = fetch,
  opts?: MatchOptions
): Promise<MatchOutcome> {
  if (!cfg) {
    return { match: null, reason: "SP-API not configured" };
  }
  const keywords = buildKeywordQuery(title ?? "");
  if (!keywords) {
    return { match: null, reason: "Title match skipped: empty title." };
  }
  try {
    const token = await getAccessToken(cfg, fetchFn, opts?.tokenCache);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/catalog/2022-04-01/items` +
      `?marketplaceIds=${encodeURIComponent(cfg.marketplaceId)}` +
      `&keywords=${encodeURIComponent(keywords)}` +
      `&includedData=summaries&pageSize=10`;
    const res = await fetchFn(url, {
      headers: {
        "x-amz-access-token": token,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        match: null,
        reason:
          `Catalog Items title search returned ${res.status}` +
          (body ? ` — ${body.slice(0, 200)}` : "") +
          " — no ASIN matched.",
      };
    }
    const data = await res.json();
    const items = parseCatalogTitleItems(data);
    if (items.length === 0) {
      return { match: null, reason: "Title search found no catalog items." };
    }
    const decision = pickTitleMatch(title, items);
    if (!decision.match) {
      return { match: null, reason: decision.reason };
    }
    return {
      match: {
        asin: decision.match.asin,
        title: decision.match.title,
        reason: decision.match.reason,
      },
      reason: decision.match.reason,
    };
  } catch (e) {
    return {
      match: null,
      reason: `Catalog Items title search failed (${e instanceof Error ? e.message : "unknown error"}) — no ASIN matched.`,
    };
  }
}
