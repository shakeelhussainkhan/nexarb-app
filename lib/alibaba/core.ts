// Alibaba Open Platform — pure core.
//
// Signing, response parsing, and landed-cost math for the buyer sourcing
// APIs (product search + product description). No network, no secrets in
// here beyond the HMAC input, so the offline harness can exercise every
// rule. The network client lives in lib/alibaba/client.ts.
//
// Signing (per Alibaba's signature doc): take all request parameters
// except "sign", sort by parameter name, concatenate name+value pairs,
// prepend the API path, and HMAC-SHA256 the result with the App Secret
// as the key, hex-encoded in uppercase.

import { createHmac } from "node:crypto";

export interface AlibabaConfig {
  appKey: string;
  appSecret: string;
  /** Gateway URL for ALL API calls — a single IOP gateway endpoint
   * (https://openapi-api.alibaba.com/rest); the API name travels as the
   * `method` parameter, per Alibaba's official IOP SDK. */
  apiBase: string;
  /** Base for OAuth authorize/token endpoints. */
  authBase: string;
}

export function alibabaConfigFromEnv(env: NodeJS.ProcessEnv): AlibabaConfig | null {
  const appKey = (env.ALIBABA_APP_KEY ?? "").trim();
  const appSecret = (env.ALIBABA_APP_SECRET ?? "").trim();
  if (!appKey || !appSecret) return null;
  return {
    appKey,
    appSecret,
    apiBase: (env.ALIBABA_API_BASE ?? "https://openapi-api.alibaba.com/rest").replace(/\/+$/, ""),
    authBase: (env.ALIBABA_AUTH_BASE ?? "https://openapi-auth.alibaba.com").replace(/\/+$/, ""),
  };
}

/** The OAuth redirect URI registered on the app — used identically by
 * the connect route (authorize) and the token exchange. */
export function alibabaRedirectUri(env: NodeJS.ProcessEnv): string {
  const appUrl = (env.NEXT_PUBLIC_APP_URL ?? "https://app.nexarb.io").replace(/\/+$/, "");
  return `${appUrl}/api/alibaba/callback`;
}

/** Build the string-to-sign: API path + sorted name/value concatenation. */
export function buildStringToSign(apiPath: string, params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== null)
    .sort();
  let out = apiPath;
  for (const k of keys) out += k + params[k];
  return out;
}

/** HMAC-SHA256 signature, uppercase hex — the value sent as `sign`. */
export function signRequest(
  appSecret: string,
  apiPath: string,
  params: Record<string, string>
): string {
  return createHmac("sha256", appSecret)
    .update(buildStringToSign(apiPath, params), "utf8")
    .digest("hex")
    .toUpperCase();
}

// --- Response parsing ------------------------------------------------------

export interface AlibabaSearchHit {
  productId: string;
  title: string;
  mainImage: string | null;
  detailUrl: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract product hits from a /eco/buyer/product/search response. The API
 * wraps results in a `result` object whose list key has varied across
 * versions (data / productList / items) — accept any of them. Never throws.
 */
export function parseSearchResults(payload: unknown): AlibabaSearchHit[] {
  try {
    const root = asRecord(payload);
    const result = asRecord(root?.result) ?? root;
    if (!result) return [];
    const list =
      (Array.isArray(result.data) && result.data) ||
      (Array.isArray(result.productList) && result.productList) ||
      (Array.isArray(result.items) && result.items) ||
      (Array.isArray(result.list) && result.list) ||
      null;
    if (!list) return [];
    const hits: AlibabaSearchHit[] = [];
    for (const raw of list) {
      const item = asRecord(raw);
      if (!item) continue;
      const productId = str(item.product_id ?? item.productId ?? item.id);
      const title = str(item.title ?? item.subject ?? item.product_name);
      if (!productId || !title) continue;
      hits.push({
        productId,
        title,
        mainImage: str(item.main_image ?? item.image_url ?? item.imageUrl) || null,
        detailUrl: str(item.detail_url ?? item.detailUrl ?? item.url) || null,
      });
    }
    return hits;
  } catch {
    return [];
  }
}

export interface AlibabaSku {
  skuId: string;
  /** Ladder tiers: buy at least `minQty`, pay `price` per unit. */
  ladder: Array<{ minQty: number; price: number }>;
  costOriginPrice: number | null;
  costDiscountPrice: number | null;
  shippingFee: number | null;
  currency: string | null;
}

export interface AlibabaProductDetail {
  productId: string;
  title: string;
  detailUrl: string | null;
  mainImage: string | null;
  moq: number | null;
  supplierName: string | null;
  currency: string | null;
  skus: AlibabaSku[];
}

function parseLadder(raw: unknown): Array<{ minQty: number; price: number }> {
  if (!Array.isArray(raw)) return [];
  const tiers: Array<{ minQty: number; price: number }> = [];
  for (const entry of raw) {
    const e = asRecord(entry);
    if (!e) continue;
    const minQty = num(e.min_order_quantity ?? e.begin_amount ?? e.quantity ?? e.minQty);
    const price = num(e.price ?? e.discount_price ?? e.origin_price);
    if (minQty !== null && price !== null && price > 0) tiers.push({ minQty, price });
  }
  return tiers.sort((a, b) => a.minQty - b.minQty);
}

/** Extract the normalized detail from a /eco/buyer/product/description
 * response (`result_data` object). Never throws; null when unusable. */
export function parseProductDescription(payload: unknown): AlibabaProductDetail | null {
  try {
    const root = asRecord(payload);
    const result = asRecord(root?.result) ?? root;
    const data = asRecord(result?.result_data) ?? asRecord(result?.data) ?? result;
    if (!data) return null;
    const productId = str(data.product_id ?? data.productId ?? data.id);
    const title = str(data.title ?? data.subject);
    if (!productId || !title) return null;

    const supplier = asRecord(data.supplier);
    const skus: AlibabaSku[] = [];
    for (const rawSku of Array.isArray(data.skus) ? data.skus : []) {
      const s = asRecord(rawSku);
      if (!s) continue;
      skus.push({
        skuId: str(s.sku_id ?? s.skuId),
        ladder: parseLadder(s.ladder_price ?? s.ladderPrice),
        costOriginPrice: num(s.cost_origin_price ?? s.total_origin_cost_price),
        costDiscountPrice: num(s.cost_discount_price ?? s.total_discount_cost_price),
        shippingFee: num(s.shipping_fee ?? s.shippingFee),
        currency: str(s.cost_price_currency ?? s.currency) || null,
      });
    }

    return {
      productId,
      title,
      detailUrl: str(data.detail_url ?? data.detailUrl) || null,
      mainImage: str(data.main_image ?? data.image_url) || null,
      moq: num(data.min_order_quantity ?? data.moq),
      supplierName: supplier ? str(supplier.company_name ?? supplier.name) || null : null,
      currency: str(data.currency) || null,
      skus,
    };
  } catch {
    return null;
  }
}

// --- Landed cost -----------------------------------------------------------

export interface LandedCost {
  skuId: string;
  /** Order quantity the math assumes: max(requested, MOQ). */
  orderQty: number;
  unitPrice: number;
  /** Shipping amortized per unit (shipping_fee treated as per-order). */
  shippingPerUnit: number;
  landedPerUnit: number;
  moq: number;
}

/** Unit price for a quantity from a ladder: the deepest tier reached. */
export function ladderPriceFor(ladder: Array<{ minQty: number; price: number }>, qty: number): number | null {
  let best: number | null = null;
  for (const tier of ladder) {
    if (qty >= tier.minQty) best = tier.price;
  }
  if (best === null && ladder.length > 0) best = ladder[0].price;
  return best;
}

/**
 * Cheapest landed cost across SKUs for ordering `requestedQty` units.
 * Unit price prefers the ladder tier reached at the order quantity,
 * falling back to the SKU's discount/origin cost price. Shipping fee is
 * treated as a per-order charge and amortized across the units — when
 * the fee is actually per-unit this understates shipping, so callers
 * should treat the result as a best case and the scan engine still
 * re-verifies margins before any BUY verdict.
 */
export function bestLandedCost(
  detail: AlibabaProductDetail,
  requestedQty: number
): LandedCost | null {
  const moq = detail.moq && detail.moq > 0 ? detail.moq : 1;
  const orderQty = Math.max(requestedQty, moq);
  let best: LandedCost | null = null;
  for (const sku of detail.skus) {
    const unitPrice =
      ladderPriceFor(sku.ladder, orderQty) ?? sku.costDiscountPrice ?? sku.costOriginPrice;
    if (unitPrice === null || !(unitPrice > 0)) continue;
    const shippingPerUnit = sku.shippingFee !== null ? sku.shippingFee / orderQty : 0;
    const landed = unitPrice + shippingPerUnit;
    if (best === null || landed < best.landedPerUnit) {
      best = {
        skuId: sku.skuId,
        orderQty,
        unitPrice: Math.round(unitPrice * 100) / 100,
        shippingPerUnit: Math.round(shippingPerUnit * 100) / 100,
        landedPerUnit: Math.round(landed * 100) / 100,
        moq,
      };
    }
  }
  return best;
}
