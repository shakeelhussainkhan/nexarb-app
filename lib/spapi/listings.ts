// Amazon SP-API Listings — read my live listings, read offer snapshots,
// write a listing price.
//
// Endpoints (documented at developer-docs.amazon.com/sp-api):
//   GET /listings/2021-08-01/items/{sellerId}
//       ?marketplaceIds=..&includedData=summaries,attributes
//       — search active listing items. Requires the "listings" role on the
//         SP-API application; without it Amazon returns 403 and we surface a
//         typed { ok:false, reason:"missing listings role" } — never fake data.
//   GET /products/pricing/v0/listings/{sellerSku}/offers
//       ?MarketplaceId=..&ItemCondition=New
//       — per-offer snapshot for the listing: offer count, landed prices,
//         and which offer is the Buy Box winner (IsBuyBoxWinner).
//   PATCH /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=..
//       body: { productType, patches:[{ op:"replace",
//              path:"/attributes/purchasable_offer", value:[{ marketplace_id,
//              currency, our_price:[{ schedule:[{ value_with_tax }] }] }] }] }
//       — sets the list price. A real price write; the caller (API route)
//         Clerk-gates it, validates bounds, and audit-logs it.
//
// Auth: same LWA x-amz-access-token exchange as lib/spapi/pricing.ts.
// Contract: nothing here throws on API failures — failures resolve to a
// typed { ok:false } with the real reason.

import type { SpApiConfig } from "@/lib/engine/eligibility";

type FetchFn = typeof fetch;

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

export type ListingsFailure =
  | { ok: false; reason: string }
  | { ok: false; reason: "missing listings role"; detail: string };

export interface SpApiListing {
  sellerSku: string;
  asin: string;
  title: string | null;
  status: string | null;
}

export interface OfferSnapshot {
  offerCount: number;
  buyboxPrice: number | null; // landed price of the Buy Box winner, USD
  buyboxWinnerIsOurs: boolean; // the winning offer belongs to the requester
  ourPrice: number | null; // our own landed offer price, if present
  checkedAt: string;
}

export interface SetPriceResult {
  ok: boolean;
  reason: string; // human-readable; "applied" on success
}

// One page of the seller's active listings. Returns the page plus a flag
// when more pages exist (the sync route follows nextToken).
export async function getMyListings(
  cfg: SpApiConfig,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; listings: SpApiListing[]; nextToken: string | null } | ListingsFailure> {
  try {
    const token = await getAccessToken(cfg, fetchFn);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/listings/2021-08-01/items/${encodeURIComponent(cfg.sellerId)}` +
      `?marketplaceIds=${encodeURIComponent(cfg.marketplaceId)}` +
      `&includedData=summaries,attributes&pageSize=100`;
    const res = await fetchFn(url, {
      headers: { "x-amz-access-token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: "missing listings role",
        detail: `SP-API returned ${res.status} on the Listings Items search — the application lacks the listings role or the refresh token's authorization changed.${body ? ` ${body.slice(0, 300)}` : ""}`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Listings search returned ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}` };
    }
    const data = (await res.json()) as {
      items?: Array<{
        sku?: string;
        summaries?: Array<{ asin?: string; itemName?: string; status?: string[] }>;
      }>;
      pagination?: { nextToken?: string };
    };
    const listings: SpApiListing[] = (data.items ?? []).map((it) => {
      const summary = it.summaries?.[0];
      return {
        sellerSku: String(it.sku ?? ""),
        asin: String(summary?.asin ?? ""),
        title: summary?.itemName ? String(summary.itemName) : null,
        status: summary?.status?.[0] ? String(summary.status[0]) : null,
      };
    }).filter((l) => l.sellerSku && l.asin);
    return {
      ok: true,
      listings,
      nextToken: data.pagination?.nextToken ? String(data.pagination.nextToken) : null,
    };
  } catch (e) {
    return { ok: false, reason: `Listings search failed (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}

// Per-offer snapshot for one of OUR seller SKUs. Uses the seller SKU (not the
// ASIN) so the snapshot describes the listing we actually sell on.
export async function getListingOffersSnapshot(
  cfg: SpApiConfig,
  sellerSku: string,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; snapshot: OfferSnapshot } | { ok: false; reason: string }> {
  const checkedAt = new Date().toISOString();
  try {
    const token = await getAccessToken(cfg, fetchFn);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/products/pricing/v0/listings/${encodeURIComponent(sellerSku)}/offers` +
      `?MarketplaceId=${encodeURIComponent(cfg.marketplaceId)}&ItemCondition=New`;
    const res = await fetchFn(url, {
      headers: { "x-amz-access-token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Offers snapshot returned ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}` };
    }
    const data = (await res.json()) as {
      payload?: {
        Offers?: Array<{
          IsBuyBoxWinner?: boolean;
          ListingPrice?: { Amount?: number };
          Shipping?: { Amount?: number };
          BelongsToRequester?: boolean;
        }>;
      };
    };
    const offers = data.payload?.Offers ?? [];
    const landed = (o: { ListingPrice?: { Amount?: number }; Shipping?: { Amount?: number } }): number | null => {
      const p = o.ListingPrice?.Amount;
      if (!(typeof p === "number") || !(p > 0)) return null;
      const s = o.Shipping?.Amount;
      return Math.round((p + (typeof s === "number" && s > 0 ? s : 0)) * 100) / 100;
    };
    const winner = offers.find((o) => o.IsBuyBoxWinner === true);
    const ours = offers.find((o) => o.BelongsToRequester === true);
    return {
      ok: true,
      snapshot: {
        offerCount: offers.length,
        buyboxPrice: winner ? landed(winner) : null,
        buyboxWinnerIsOurs: Boolean(winner?.BelongsToRequester),
        ourPrice: ours ? landed(ours) : null,
        checkedAt,
      },
    };
  } catch (e) {
    return { ok: false, reason: `Offers snapshot failed (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}

// REAL price write — changes the live listing price on Amazon. Callers must
// Clerk-gate, validate bounds, and audit-log. Never invents a success.
export async function setListingPrice(
  cfg: SpApiConfig,
  sellerSku: string,
  price: number,
  fetchFn: FetchFn = fetch
): Promise<SetPriceResult> {
  const rounded = Math.round(price * 100) / 100;
  if (!(rounded > 0)) return { ok: false, reason: "Refused: price must be positive." };
  try {
    const token = await getAccessToken(cfg, fetchFn);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/listings/2021-08-01/items/${encodeURIComponent(cfg.sellerId)}/${encodeURIComponent(sellerSku)}` +
      `?marketplaceIds=${encodeURIComponent(cfg.marketplaceId)}`;
    const res = await fetchFn(url, {
      method: "PATCH",
      headers: {
        "x-amz-access-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        productType: "PRODUCT",
        patches: [
          {
            op: "replace",
            path: "/attributes/purchasable_offer",
            value: [
              {
                marketplace_id: cfg.marketplaceId,
                currency: "USD",
                our_price: [{ schedule: [{ value_with_tax: rounded }] }],
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `Price write refused (${res.status}) — the SP-API application lacks the listings write role.${body ? ` ${body.slice(0, 300)}` : ""}`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Price write failed (${res.status})${body ? ` — ${body.slice(0, 300)}` : ""}` };
    }
    return { ok: true, reason: `applied $${rounded.toFixed(2)} to ${sellerSku}` };
  } catch (e) {
    return { ok: false, reason: `Price write failed (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}
