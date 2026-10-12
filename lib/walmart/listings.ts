// Walmart Marketplace listings — read my own items, update an item price.
//
// Documented endpoints (developer.walmart.com, Marketplace API):
//   GET {endpoint}/v3/items?limit=50
//       — list the seller's own catalog items. Response includes sku,
//         product name, and price info per item.
//   PUT {endpoint}/v3/price
//       body: { sku, pricing:[{ currentPriceType:"BASE",
//              currentPrice:{ currency:"USD", amount } }] }
//       — update the price of one of MY OWN SKUs. A real price write on the
//         Walmart marketplace; the caller (API route) Clerk-gates it,
//         validates bounds, and audit-logs it.
//
// Auth: WM_SEC.ACCESS_TOKEN header via lib/walmart/client.ts token exchange.
// Contract: nothing here throws on API failures — failures resolve to a
// typed { ok:false } with the real status/reason. If the granted scopes do
// not include items/price management, Walmart answers 401/403 and that is
// surfaced verbatim as "missing price role" — never a fake success.

import {
  getWalmartAccessToken,
  type WalmartConfig,
} from "@/lib/walmart/client.ts";

type FetchFn = typeof fetch;

function correlationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export interface WalmartItem {
  sku: string;
  productName: string | null;
  price: number | null; // current BASE price in USD
}

export interface WalmartSetPriceResult {
  ok: boolean;
  reason: string;
}

async function authHeaders(cfg: WalmartConfig, fetchFn: FetchFn): Promise<Record<string, string>> {
  const token = await getWalmartAccessToken(cfg, fetchFn);
  return {
    "WM_SEC.ACCESS_TOKEN": token.accessToken,
    "WM_SVC.NAME": cfg.serviceName,
    "WM_QOS.CORRELATION_ID": correlationId(),
    Accept: "application/json",
  };
}

export async function getWalmartItems(
  cfg: WalmartConfig,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; items: WalmartItem[] } | { ok: false; reason: string }> {
  try {
    const headers = await authHeaders(cfg, fetchFn);
    const res = await fetchFn(`${cfg.endpoint}/v3/items?limit=50`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: `Walmart items read refused (${res.status}) — the API application lacks the items scope.`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Walmart items read returned ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}` };
    }
    const data = (await res.json()) as {
      ItemResponse?: Array<{
        sku?: string;
        productName?: string;
        price?: { amount?: number; currency?: string };
      }>;
    };
    const items: WalmartItem[] = (data.ItemResponse ?? []).map((it) => ({
      sku: String(it.sku ?? ""),
      productName: it.productName ? String(it.productName) : null,
      price:
        typeof it.price?.amount === "number" && it.price.amount > 0
          ? Math.round(it.price.amount * 100) / 100
          : null,
    })).filter((i) => i.sku);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, reason: `Walmart items read failed (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}

// REAL price write — changes the live price of one of MY OWN Walmart SKUs.
export async function setWalmartPrice(
  cfg: WalmartConfig,
  sku: string,
  price: number,
  fetchFn: FetchFn = fetch
): Promise<WalmartSetPriceResult> {
  const rounded = Math.round(price * 100) / 100;
  if (!(rounded > 0)) return { ok: false, reason: "Refused: price must be positive." };
  try {
    const headers = await authHeaders(cfg, fetchFn);
    const res = await fetchFn(`${cfg.endpoint}/v3/price`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        pricing: [
          {
            currentPriceType: "BASE",
            currentPrice: { currency: "USD", amount: rounded },
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: `Walmart price write refused (${res.status}) — the API application lacks the price-management scope.`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Walmart price write failed (${res.status})${body ? ` — ${body.slice(0, 300)}` : ""}` };
    }
    return { ok: true, reason: `applied $${rounded.toFixed(2)} to ${sku}` };
  } catch (e) {
    return { ok: false, reason: `Walmart price write failed (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}
