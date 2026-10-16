// SP-API Product Pricing v2022-05-01 — Featured Offer Expected Price
// (FOEP): the computed listing price at or below which our offer can
// expect to win the Featured Offer (Buy Box) for a SKU.
//
//   POST /batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice
//   (operation getFeaturedOfferExpectedPriceBatch; see lib/spapi/
//   foepCore.ts for the official wire shapes and doc references)
//
// Required role: Pricing (the same role the app already holds for
// Product Pricing). Regions: NA/EU/FE. Usage plan is tight — 0.033
// requests/sec, burst 1 — so this module makes exactly ONE batch call
// (up to 40 SKUs) per invocation and never loops or retries in-band.
//
// ADVISORY ONLY: nothing here writes a price. The Listings page shows
// the FOEP as a hint; the two-step manual Apply in the reprice route
// remains the only way a live price changes.
//
// Failures never throw and never fabricate: a failed batch resolves to
// an explicit unavailable result per requested SKU with the real
// reason, mirroring lib/spapi/pricing.ts.
//
// Auth: same LWA access-token exchange as lib/engine/eligibility.ts
// (x-amz-access-token header), duplicated per module by repo convention.

import type { SpApiConfig } from "@/lib/engine/eligibility";
import {
  FOEP_BATCH_PATH,
  buildFoepBatchRequest,
  parseFoepBatchResponse,
  unavailableFoepResult,
  type FoepSkuResult,
} from "./foepCore";

type FetchFn = typeof fetch;

export interface FoepBatchOutcome {
  /** One result per unique requested SKU (post cap), in request order. */
  results: FoepSkuResult[];
  /** Batch-level failure reason; null when the batch call succeeded. */
  reason: string | null;
  checkedAt: string; // ISO
  /** True when more unique SKUs were supplied than the 40-request cap. */
  capped: boolean;
}

async function getAccessToken(cfg: SpApiConfig, fetchFn: FetchFn): Promise<string> {
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

/**
 * Fetch FOEP data for a set of seller SKUs in ONE batch call. Never
 * throws: any failure (auth, HTTP, network, malformed payload) resolves
 * to per-SKU unavailable results carrying the reason.
 */
export async function getFeaturedOfferExpectedPrices(
  cfg: SpApiConfig,
  skus: string[],
  fetchFn: FetchFn = fetch
): Promise<FoepBatchOutcome> {
  const checkedAt = new Date().toISOString();
  const build = buildFoepBatchRequest(skus, cfg.marketplaceId);
  if (build.skus.length === 0) {
    return { results: [], reason: "No SKUs requested.", checkedAt, capped: false };
  }
  const failAll = (reason: string): FoepBatchOutcome => ({
    results: build.skus.map((sku) => unavailableFoepResult(sku, reason)),
    reason,
    checkedAt,
    capped: build.capped,
  });
  try {
    const token = await getAccessToken(cfg, fetchFn);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const res = await fetchFn(`${endpoint}${FOEP_BATCH_PATH}`, {
      method: "POST",
      headers: {
        "x-amz-access-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(build.body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return failAll(
        `SP-API FOEP batch returned ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""} — Featured Offer prices unknown, not treated as zero.`
      );
    }
    const data: unknown = await res.json();
    return {
      results: parseFoepBatchResponse(data, build.skus),
      reason: null,
      checkedAt,
      capped: build.capped,
    };
  } catch (e) {
    return failAll(
      `FOEP lookup failed (${e instanceof Error ? e.message : "unknown error"}) — Featured Offer prices unknown.`
    );
  }
}
