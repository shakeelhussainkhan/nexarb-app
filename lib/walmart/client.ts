// Walmart Marketplace API client — OAuth2 client-credentials auth.
//
// The seller's own "My API Key" (ClientId + ClientSecret, pre-provisioned in
// the Walmart Developer Portal under API Keys) is exchanged for a short-lived
// access token, which is then passed per-call in the WM_SEC.ACCESS_TOKEN
// header. Docs: developer.walmart.com (Marketplace Authentication API).
//
// Design mirrors lib/engine/eligibility.ts: pure functions with an injectable
// fetch so everything is unit-testable offline. Health checks never throw —
// failures resolve to { connected: false }, never a false positive.

export interface WalmartConfig {
  clientId: string;
  clientSecret: string;
  endpoint: string; // e.g. https://marketplace.walmartapis.com (production)
  serviceName: string; // WM_SVC.NAME header value
}

export function walmartConfigFromEnv(
  env: Record<string, string | undefined>
): WalmartConfig | null {
  const clientId = env.WALMART_API_CLIENT_ID;
  const clientSecret = env.WALMART_API_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    endpoint:
      env.WALMART_API_ENDPOINT ?? "https://marketplace.walmartapis.com",
    serviceName: env.WALMART_SVC_NAME ?? "Walmart Marketplace",
  };
}

type FetchFn = typeof fetch;

function correlationId(): string {
  // crypto.randomUUID is available in Node 18+ and all modern runtimes.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export interface WalmartToken {
  accessToken: string;
  expiresIn: number; // seconds
}

// Exchange ClientId/ClientSecret for an access token.
// POST {endpoint}/v3/token with grant_type=client_credentials.
export async function getWalmartAccessToken(
  cfg: WalmartConfig,
  fetchFn: FetchFn = fetch
): Promise<WalmartToken> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    "base64"
  );
  const res = await fetchFn(`${cfg.endpoint}/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "WM_SVC.NAME": cfg.serviceName,
      "WM_QOS.CORRELATION_ID": correlationId(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Walmart token exchange ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("Walmart token exchange returned no access token");
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 900 };
}

export interface WalmartTokenDetail {
  isValid?: boolean;
  expiresAt?: string;
  scopes?: Record<string, string>;
  raw: unknown;
}

// GET {endpoint}/v3/token/detail — returns the token's validity window and
// the OAuth scopes granted to the application. Ideal connectivity check.
export async function getWalmartTokenDetail(
  cfg: WalmartConfig,
  token: WalmartToken,
  fetchFn: FetchFn = fetch
): Promise<WalmartTokenDetail> {
  const res = await fetchFn(`${cfg.endpoint}/v3/token/detail`, {
    headers: {
      "WM_SEC.ACCESS_TOKEN": token.accessToken,
      "WM_SVC.NAME": cfg.serviceName,
      "WM_QOS.CORRELATION_ID": correlationId(),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Walmart token detail ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const scopes: Record<string, string> = {};
  // Normalize the common scopes-by-category shape into a flat map.
  const walk = (obj: unknown, prefix = ""): void => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string") scopes[prefix + k] = v;
      else if (v && typeof v === "object") walk(v, `${prefix}${k}.`);
    }
  };
  const scopeNode =
    data.scopes ?? data.permissions ?? data.access_levels ?? null;
  if (scopeNode) walk(scopeNode);
  return {
    isValid:
      typeof data.is_valid === "boolean"
        ? (data.is_valid as boolean)
        : typeof data.isValid === "boolean"
          ? (data.isValid as boolean)
          : undefined,
    expiresAt:
      typeof data.expires_at === "string"
        ? (data.expires_at as string)
        : typeof data.expiresAt === "string"
          ? (data.expiresAt as string)
          : undefined,
    scopes: Object.keys(scopes).length ? scopes : undefined,
    raw: data,
  };
}

export interface WalmartHealth {
  connected: boolean;
  tokenValid?: boolean;
  expiresAt?: string;
  scopeCount?: number;
  checkedAt: string; // ISO
  source: "walmart-api" | "unconfigured" | "error";
  reason?: string;
}

// Full connectivity check: token exchange + token detail. Never throws.
export async function checkWalmartHealth(
  cfg: WalmartConfig | null,
  fetchFn: FetchFn = fetch
): Promise<WalmartHealth> {
  const checkedAt = new Date().toISOString();
  if (!cfg) {
    return {
      connected: false,
      checkedAt,
      source: "unconfigured",
      reason: "Walmart API credentials not configured — set WALMART_API_CLIENT_ID and WALMART_API_CLIENT_SECRET.",
    };
  }
  try {
    const token = await getWalmartAccessToken(cfg, fetchFn);
    const detail = await getWalmartTokenDetail(cfg, token, fetchFn);
    return {
      connected: true,
      tokenValid: detail.isValid,
      expiresAt: detail.expiresAt,
      scopeCount: detail.scopes ? Object.keys(detail.scopes).length : undefined,
      checkedAt,
      source: "walmart-api",
    };
  } catch (e) {
    return {
      connected: false,
      checkedAt,
      source: "error",
      reason: `Walmart health check failed (${e instanceof Error ? e.message : "unknown error"}).`,
    };
  }
}
