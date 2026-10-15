// Alibaba Open Platform — server client.
//
// OAuth token storage (nexarb_settings, migration 014), refresh, and the
// two buyer sourcing calls (product search + description). Every failure
// resolves to a typed { ok: false, error } — callers never see a throw
// for an Alibaba-side problem.
//
// Env: ALIBABA_APP_KEY / ALIBABA_APP_SECRET (Vercel), optional
// ALIBABA_API_BASE / ALIBABA_AUTH_BASE overrides (lib/alibaba/core.ts).

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  alibabaConfigFromEnv,
  signRequest,
  parseSearchResults,
  describeShape,
  parseProductDescription,
  type AlibabaConfig,
  type AlibabaSearchHit,
  type AlibabaProductDetail,
} from "./core";

export interface AlibabaTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null; // ISO
  account: string | null;
}

type Admin = ReturnType<typeof getSupabaseAdmin>;

export async function readAlibabaTokens(admin: Admin, userId: string): Promise<AlibabaTokens | null> {
  const { data, error } = await admin
    .from("nexarb_settings")
    .select("alibaba_access_token, alibaba_refresh_token, alibaba_token_expires_at, alibaba_account")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    alibaba_access_token: string | null;
    alibaba_refresh_token: string | null;
    alibaba_token_expires_at: string | null;
    alibaba_account: string | null;
  };
  if (!row.alibaba_access_token) return null;
  return {
    accessToken: row.alibaba_access_token,
    refreshToken: row.alibaba_refresh_token,
    expiresAt: row.alibaba_token_expires_at,
    account: row.alibaba_account,
  };
}

export async function saveAlibabaTokens(
  admin: Admin,
  userId: string,
  tokens: AlibabaTokens
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from("nexarb_settings").upsert(
    {
      user_id: userId,
      alibaba_access_token: tokens.accessToken,
      alibaba_refresh_token: tokens.refreshToken,
      alibaba_token_expires_at: tokens.expiresAt,
      alibaba_account: tokens.account,
      alibaba_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  account?: string;
  account_id?: string;
  error?: string;
  error_description?: string;
}

function expiresAtFrom(expiresInSec: unknown): string | null {
  const n = typeof expiresInSec === "number" ? expiresInSec : Number(expiresInSec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() + n * 1000).toISOString();
}

interface IopErrorBody {
  type?: string;
  code?: string;
  message?: string;
}

/**
 * One IOP gateway call, exactly as Alibaba's official SDK performs it:
 * a single gateway URL for every API; the API name travels as the
 * `method` parameter; system parameters (app_key, sign_method, timestamp,
 * partner_id, simplify, format, access_token) are merged with the
 * business parameters; the signature is HMAC-SHA256 over
 * method + sorted key/value concatenation of ALL parameters; GET calls
 * put parameters in the query string, POST calls form-encode them.
 * A top-level `code` other than "0" in the response is a gateway error.
 */
async function iopCall(
  cfg: AlibabaConfig,
  method: string,
  businessParams: Record<string, string>,
  opts: { accessToken?: string; httpMethod: "GET" | "POST" }
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const params: Record<string, string> = {
    app_key: cfg.appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    partner_id: "nexarb-1.0",
    method,
    simplify: "true",
    format: "json",
    ...(opts.accessToken ? { access_token: opts.accessToken } : {}),
    ...businessParams,
  };
  const sign = signRequest(cfg.appSecret, method, params);
  const all = { ...params, sign };
  try {
    let res: Response;
    if (opts.httpMethod === "GET") {
      const qs = new URLSearchParams(all).toString();
      res = await fetch(`${cfg.apiBase}?${qs}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
    } else {
      res = await fetch(cfg.apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(all).toString(),
        signal: AbortSignal.timeout(20000),
      });
    }
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & IopErrorBody) | null;
    if (data && typeof data.code === "string" && data.code !== "0") {
      return { ok: false, error: `Alibaba ${method} failed [${data.type ?? "?"}/${data.code}]: ${data.message ?? "unknown error"}` };
    }
    if (!res.ok) {
      return { ok: false, error: `Alibaba ${method} returned HTTP ${res.status}` };
    }
    if (data === null) {
      return { ok: false, error: `Alibaba ${method} returned an unreadable response` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Alibaba API call failed" };
  }
}

/**
 * Generic signed IOP call for API groups beyond sourcing (orders.ts uses
 * this for the order flow). Same transport as every other call — the API
 * name travels as the `method` parameter; signing happens inside iopCall.
 */
export async function callAlibabaApi(
  cfg: AlibabaConfig,
  accessToken: string,
  method: string,
  businessParams: Record<string, string>,
  httpMethod: "GET" | "POST" = "POST"
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return iopCall(cfg, method, businessParams, { accessToken, httpMethod });
}

/** Token create/refresh via the IOP gateway (POST, no access token). */
async function callTokenEndpoint(
  cfg: AlibabaConfig,
  path: string,
  params: Record<string, string>
): Promise<{ ok: boolean; tokens?: AlibabaTokens; error?: string }> {
  const res = await iopCall(cfg, path, params, { httpMethod: "POST" });
  if (!res.ok) return { ok: false, error: res.error };
  const data = res.data as TokenResponse;
  if (!data?.access_token) {
    return { ok: false, error: "Alibaba's token response did not include an access_token." };
  }
  return {
    ok: true,
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: expiresAtFrom(data.expires_in),
      account: data.account ?? (data.account_id ? String(data.account_id) : null),
    },
  };
}

/** Exchange the OAuth authorization code from the callback for tokens.
 * Alibaba's token-create API documents exactly one business parameter —
 * `code` — so the exchange sends exactly that (the SDK's own token
 * sample does the same). */
export async function exchangeAlibabaCode(
  cfg: AlibabaConfig,
  code: string
): Promise<{ ok: boolean; tokens?: AlibabaTokens; error?: string }> {
  return callTokenEndpoint(cfg, "/auth/token/create", { code });
}

/**
 * Return a usable access token for the user, refreshing when the stored
 * token is expired or within 5 minutes of expiry. Persists refreshes.
 */
export async function getValidAlibabaToken(
  admin: Admin,
  userId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; token?: string; cfg?: AlibabaConfig; error?: string }> {
  const cfg = alibabaConfigFromEnv(env);
  if (!cfg) return { ok: false, error: "Alibaba is not configured (ALIBABA_APP_KEY / ALIBABA_APP_SECRET missing)." };

  const tokens = await readAlibabaTokens(admin, userId);
  if (!tokens) {
    return { ok: false, error: "Alibaba is not connected for this account — connect it from the Alibaba page first." };
  }
  const expiresMs = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : NaN;
  const stillValid = Number.isFinite(expiresMs) && expiresMs - Date.now() > 5 * 60 * 1000;
  if (stillValid || !tokens.refreshToken) {
    return { ok: true, token: tokens.accessToken, cfg };
  }
  const refreshed = await callTokenEndpoint(cfg, "/auth/token/refresh", {
    refresh_token: tokens.refreshToken,
  });
  if (!refreshed.ok || !refreshed.tokens) {
    return { ok: false, error: `Alibaba token refresh failed: ${refreshed.error ?? "unknown error"} — reconnect from the Alibaba page.` };
  }
  const merged: AlibabaTokens = {
    ...refreshed.tokens,
    refreshToken: refreshed.tokens.refreshToken ?? tokens.refreshToken,
    account: refreshed.tokens.account ?? tokens.account,
  };
  await saveAlibabaTokens(admin, userId, merged);
  return { ok: true, token: merged.accessToken, cfg };
}

/** Keyword product search (buyer API). Business params ride in `param0`. */
export async function searchAlibabaProducts(
  cfg: AlibabaConfig,
  accessToken: string,
  opts: { keyword: string; page?: number; size?: number; shipToCountry?: string }
): Promise<{ ok: boolean; hits?: AlibabaSearchHit[]; shape?: ReturnType<typeof describeShape>; raw?: unknown; error?: string }> {
  const param0 = JSON.stringify({
    keyword: opts.keyword,
    index: opts.page ?? 1,
    size: Math.min(Math.max(opts.size ?? 10, 1), 50),
    shipToCountry: opts.shipToCountry ?? "US",
    currency: "USD",
    language: "en",
  });
  const res = await iopCall(cfg, "/eco/buyer/product/search", { param0 }, { accessToken, httpMethod: "GET" });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, hits: parseSearchResults(res.data), shape: describeShape(res.data), raw: res.data };
}

/** Full product detail (MOQ, ladder prices, shipping, supplier).
 * Business params ride in a `query_req` JSON wrapper — the API rejects
 * flat params with MissingParameter: query_req (observed live
 * 2026-10-13). Search uses a different wrapper name (`param0`). */
export async function getAlibabaProduct(
  cfg: AlibabaConfig,
  accessToken: string,
  productId: string
): Promise<{ ok: boolean; detail?: AlibabaProductDetail; raw?: unknown; error?: string }> {
  const queryReq = JSON.stringify({
    product_id: Number(productId),
    country: "US",
    language: "en",
    currency: "USD",
    ship_to_country: "US",
  });
  const res = await iopCall(
    cfg,
    "/eco/buyer/product/description",
    { query_req: queryReq },
    { accessToken, httpMethod: "GET" }
  );
  if (!res.ok) return { ok: false, error: res.error };
  const detail = parseProductDescription(res.data);
  if (!detail) {
    return { ok: false, error: "Alibaba returned a product description we could not parse.", raw: res.data };
  }
  return { ok: true, detail, raw: res.data };
}
