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
  alibabaCandidateBases,
  signRequest,
  parseSearchResults,
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

/**
 * POST a token endpoint (create/refresh), trying each candidate base in
 * order — the token endpoint 404s on the OAuth host (observed live), so
 * the gateway that actually serves System APIs has to be discovered. A
 * non-404 response (success OR a JSON error) identifies the right host.
 * Calls use the same header-signing scheme as the data APIs.
 */
async function callTokenEndpoint(
  cfg: AlibabaConfig,
  path: string,
  params: Record<string, string>
): Promise<{ ok: boolean; tokens?: AlibabaTokens; error?: string }> {
  let lastError = "no candidate gateway answered";
  for (const base of alibabaCandidateBases(cfg)) {
    try {
      const timestamp = String(Date.now());
      const signed = { ...params, app_key: cfg.appKey, timestamp };
      const sign = signRequest(cfg.appSecret, path, signed);
      const qs = new URLSearchParams(signed).toString();
      const res = await fetch(`${base}${path}?${qs}`, {
        method: "POST",
        headers: {
          app_key: cfg.appKey,
          timestamp,
          sign_method: "sha256",
          sign,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 404) {
        lastError = `token endpoint returned 404 on ${base}`;
        continue;
      }
      const data = (await res.json().catch(() => null)) as TokenResponse | null;
      if (!res.ok || !data?.access_token) {
        return {
          ok: false,
          error: `${data?.error_description ?? data?.error ?? `token endpoint returned ${res.status}`} (via ${base})`,
        };
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
    } catch (e) {
      lastError = e instanceof Error ? e.message : "token request failed";
    }
  }
  return { ok: false, error: lastError };
}

/** Exchange the OAuth authorization code from the callback for tokens.
 * The redirect_uri is repeated in the exchange — several OAuth servers
 * (Alibaba included, per its ISV authorization doc) require it to match
 * the one used at authorize time. */
export async function exchangeAlibabaCode(
  cfg: AlibabaConfig,
  code: string,
  redirectUri: string
): Promise<{ ok: boolean; tokens?: AlibabaTokens; error?: string }> {
  return callTokenEndpoint(cfg, "/auth/token/create", { code, redirect_uri: redirectUri });
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

/** Signed GET against the API gateway. Per the console's own SDK sample,
 * the auth material (app_key, timestamp, access_token, sign) travels as
 * HEADERS and only the business params ride in the query string. The
 * signature covers all of those parameters (business + auth, minus the
 * signature itself). The gateway host is unpublished, so candidate
 * bases are tried in order until one answers with a non-404. */
async function signedGet(
  cfg: AlibabaConfig,
  accessToken: string,
  apiPath: string,
  params: Record<string, string>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  let lastError = "no candidate gateway answered";
  for (const base of alibabaCandidateBases(cfg)) {
    try {
      const timestamp = String(Date.now());
      const signParams: Record<string, string> = {
        ...params,
        access_token: accessToken,
        app_key: cfg.appKey,
        timestamp,
      };
      const sign = signRequest(cfg.appSecret, apiPath, signParams);
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`${base}${apiPath}${qs ? `?${qs}` : ""}`, {
        headers: {
          Accept: "application/json",
          app_key: cfg.appKey,
          timestamp,
          access_token: accessToken,
          sign_method: "sha256",
          sign,
        },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) {
        lastError = `Alibaba API ${apiPath} returned 404 on ${base}`;
        continue;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const snippet = data !== null ? JSON.stringify(data).slice(0, 200) : "";
        return {
          ok: false,
          error: `Alibaba API ${apiPath} returned ${res.status} (via ${base})${snippet ? ` — ${snippet}` : ""}`,
        };
      }
      return { ok: true, data };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Alibaba API call failed";
    }
  }
  return { ok: false, error: lastError };
}

/** Keyword product search (buyer API). Business params ride in `param0`. */
export async function searchAlibabaProducts(
  cfg: AlibabaConfig,
  accessToken: string,
  opts: { keyword: string; page?: number; size?: number; shipToCountry?: string }
): Promise<{ ok: boolean; hits?: AlibabaSearchHit[]; error?: string }> {
  const param0 = JSON.stringify({
    keyword: opts.keyword,
    index: opts.page ?? 1,
    size: Math.min(Math.max(opts.size ?? 10, 1), 50),
    shipToCountry: opts.shipToCountry ?? "US",
    currency: "USD",
    language: "en",
  });
  const res = await signedGet(cfg, accessToken, "/eco/buyer/product/search", { param0 });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, hits: parseSearchResults(res.data) };
}

/** Full product detail (MOQ, ladder prices, shipping, supplier). */
export async function getAlibabaProduct(
  cfg: AlibabaConfig,
  accessToken: string,
  productId: string
): Promise<{ ok: boolean; detail?: AlibabaProductDetail; error?: string }> {
  const res = await signedGet(cfg, accessToken, "/eco/buyer/product/description", {
    product_id: productId,
    country: "US",
    language: "en",
    currency: "USD",
    ship_to_country: "US",
  });
  if (!res.ok) return { ok: false, error: res.error };
  const detail = parseProductDescription(res.data);
  if (!detail) return { ok: false, error: "Alibaba returned a product description we could not parse." };
  return { ok: true, detail };
}
