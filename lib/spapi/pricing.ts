// SP-API Product Pricing — live competitive (Buy Box / landed) price.
//
// GET /products/pricing/v0/competitivePrice?MarketplaceId=..&Asin=..&ItemType=Asin
// This API is not a restricted role: any authorized SP-API application may
// call it. Failures resolve to { price: null } with a reason — never a
// fabricated price. Callers must treat a null price as "unknown", not zero.
//
// Auth: same LWA access-token exchange as lib/engine/eligibility.ts
// (x-amz-access-token header).

import type { SpApiConfig } from "@/lib/engine/eligibility";

type FetchFn = typeof fetch;

export interface LiveSellPrice {
  price: number | null; // landed competitive price in USD, null when unknown
  currency: string;
  reason: string; // human-readable provenance, always set
  checkedAt: string; // ISO
  source: "sp-api-pricing" | "error";
  /** True when the picked competitive price is our own offer (we hold the Buy Box lane); false when it's a competitor's; null when unknown/lookup failed. */
  belongsToRequester: boolean | null;
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

interface CompetitivePriceEntry {
  Price?: { LandedPrice?: { Amount?: number; CurrencyCode?: string } };
  condition?: string;
  subcondition?: string;
  belongsToRequester?: boolean;
}

/**
 * Fetch the live landed competitive price for an ASIN in the configured
 * marketplace. Prefers the requester's own offer when present, otherwise the
 * first "New" competitive price.
 */
export async function getLiveSellPrice(
  cfg: SpApiConfig,
  asin: string,
  fetchFn: FetchFn = fetch
): Promise<LiveSellPrice> {
  const checkedAt = new Date().toISOString();
  const fail = (reason: string): LiveSellPrice => ({
    price: null,
    currency: "USD",
    reason,
    checkedAt,
    source: "error",
    belongsToRequester: null,
  });
  try {
    const token = await getAccessToken(cfg, fetchFn);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/products/pricing/v0/competitivePrice` +
      `?MarketplaceId=${encodeURIComponent(cfg.marketplaceId)}` +
      `&Asins=${encodeURIComponent(asin)}&ItemType=Asin`;
    const res = await fetchFn(url, {
      headers: {
        "x-amz-access-token": token,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail(
        `SP-API pricing returned ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""} — live sell price unknown, not treated as zero.`
      );
    }
    const data = (await res.json()) as {
      payload?: Array<{
        status?: string;
        ASIN?: string;
        Product?: {
          CompetitivePricing?: { CompetitivePrices?: CompetitivePriceEntry[] };
        };
        CompetitivePricing?: { CompetitivePrices?: CompetitivePriceEntry[] };
      }>;
    };
    const entries =
      data.payload?.[0]?.Product?.CompetitivePricing?.CompetitivePrices ?? [];
    if (!entries.length) {
      return fail("No competitive prices returned for this ASIN.");
    }
    const pick =
      entries.find((e) => e.belongsToRequester) ??
      entries.find((e) => e.subcondition === "New") ??
      entries[0];
    const amount = pick?.Price?.LandedPrice?.Amount;
    const currency = pick?.Price?.LandedPrice?.CurrencyCode ?? "USD";
    if (!(typeof amount === "number") || !(amount > 0)) {
      return fail("Competitive price present but amount missing or invalid.");
    }
    return {
      price: Math.round(amount * 100) / 100,
      currency,
      reason: pick?.belongsToRequester
        ? "Your own current offer price (landed)."
        : "Live landed competitive price (Buy Box lane).",
      checkedAt,
      source: "sp-api-pricing",
      belongsToRequester: pick?.belongsToRequester ?? null,
    };
  } catch (e) {
    return fail(
      `Pricing lookup failed (${e instanceof Error ? e.message : "unknown error"}) — live sell price unknown.`
    );
  }
}
