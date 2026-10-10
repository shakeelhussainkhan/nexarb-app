// Amazon sell-eligibility (gating) check — SP-API Listings Restrictions.
//
// States are deliberately four-way and never collapse: an API error, missing
// credentials, or a stale/absent answer is UNKNOWN, never SELLABLE. A false
// green light strands purchased inventory; a false UNKNOWN only costs a
// re-check. (Design: 2026-10-10 gating research.)

export type EligibilityState = "SELLABLE" | "APPROVAL_REQUIRED" | "BLOCKED" | "UNKNOWN";

export interface RestrictionReason {
  message: string;
  reasonCode: "APPROVAL_REQUIRED" | "NOT_ELIGIBLE" | "ASIN_NOT_FOUND" | string;
  links?: { resource?: string; title?: string }[];
}

export interface Restriction {
  marketplaceId: string;
  conditionType?: string;
  reasons: RestrictionReason[];
}

export interface EligibilityResult {
  state: EligibilityState;
  reasons: string[];
  approvalLinks: string[];
  checkedAt: string; // ISO
  source: "sp-api" | "cache" | "unconfigured" | "error";
}

export function evaluateRestrictions(restrictions: Restriction[], checkedAt = new Date()): EligibilityResult {
  const all = restrictions.flatMap((r) => r.reasons ?? []);
  const base = { checkedAt: checkedAt.toISOString(), source: "sp-api" as const };

  if (all.some((r) => r.reasonCode === "ASIN_NOT_FOUND")) {
    return { ...base, state: "UNKNOWN", reasons: ["ASIN not found in this marketplace — cannot confirm eligibility."], approvalLinks: [] };
  }
  if (all.some((r) => r.reasonCode === "NOT_ELIGIBLE")) {
    const msgs = all.filter((r) => r.reasonCode === "NOT_ELIGIBLE").map((r) => r.message);
    return { ...base, state: "BLOCKED", reasons: msgs.length ? msgs : ["Not eligible to list this ASIN — no application path."], approvalLinks: [] };
  }
  if (all.some((r) => r.reasonCode === "APPROVAL_REQUIRED")) {
    const gated = all.filter((r) => r.reasonCode === "APPROVAL_REQUIRED");
    return {
      ...base,
      state: "APPROVAL_REQUIRED",
      reasons: gated.map((r) => r.message),
      approvalLinks: gated.flatMap((r) => (r.links ?? []).map((l) => l.resource ?? "").filter(Boolean)),
    };
  }
  if (restrictions.length === 0 || all.length === 0) {
    return { ...base, state: "SELLABLE", reasons: ["No listing restrictions for this account/ASIN."], approvalLinks: [] };
  }
  return { ...base, state: "UNKNOWN", reasons: ["Unrecognised restriction response — treated as unknown."], approvalLinks: [] };
}

// TTL cache: clean results trusted 24h; restricted results re-checked sooner.
const CLEAN_TTL_MS = 24 * 3600 * 1000;
const RESTRICTED_TTL_MS = 3 * 3600 * 1000;

export class EligibilityCache {
  private store = new Map<string, { at: number; result: EligibilityResult }>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private key(sellerId: string, asin: string, marketplaceId: string) {
    return `${sellerId}|${asin}|${marketplaceId}`;
  }

  get(sellerId: string, asin: string, marketplaceId: string): EligibilityResult | undefined {
    const hit = this.store.get(this.key(sellerId, asin, marketplaceId));
    if (!hit) return undefined;
    const ttl = hit.result.state === "SELLABLE" ? CLEAN_TTL_MS : RESTRICTED_TTL_MS;
    if (this.now() - hit.at > ttl) return undefined;
    return { ...hit.result, source: "cache" };
  }

  set(sellerId: string, asin: string, marketplaceId: string, result: EligibilityResult): void {
    if (result.state === "UNKNOWN") return; // never cache ignorance
    this.store.set(this.key(sellerId, asin, marketplaceId), { at: this.now(), result });
  }
}

// --- SP-API access -----------------------------------------------------------

export interface SpApiConfig {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  sellerId: string;
  marketplaceId: string; // e.g. ATVPDKIKX0DER (US)
  endpoint?: string; // default NA endpoint
}

type FetchFn = typeof fetch;

export function spApiConfigFromEnv(env: Record<string, string | undefined>): SpApiConfig | null {
  const refreshToken = env.AMAZON_SPAPI_REFRESH_TOKEN;
  const clientId = env.AMAZON_SPAPI_CLIENT_ID;
  const clientSecret = env.AMAZON_SPAPI_CLIENT_SECRET;
  const sellerId = env.AMAZON_SELLER_ID;
  const marketplaceId = env.AMAZON_MARKETPLACE_ID ?? "ATVPDKIKX0DER";
  if (!refreshToken || !clientId || !clientSecret || !sellerId) return null;
  return { refreshToken, clientId, clientSecret, sellerId, marketplaceId };
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

// One live eligibility check. Never throws: failures resolve to UNKNOWN.
export async function checkEligibilityLive(
  cfg: SpApiConfig,
  asin: string,
  fetchFn: FetchFn = fetch
): Promise<EligibilityResult> {
  try {
    const token = await getAccessToken(cfg, fetchFn);
    const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
    const url =
      `${endpoint}/listings/2021-08-01/restrictions` +
      `?asin=${encodeURIComponent(asin)}&sellerId=${encodeURIComponent(cfg.sellerId)}` +
      `&marketplaceIds=${encodeURIComponent(cfg.marketplaceId)}&conditionType=new_new`;
    const res = await fetchFn(url, {
      headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Listings Restrictions ${res.status}`);
    const data = (await res.json()) as { restrictions?: Restriction[] };
    return evaluateRestrictions(data.restrictions ?? []);
  } catch (e) {
    return {
      state: "UNKNOWN",
      reasons: [`Eligibility check failed (${e instanceof Error ? e.message : "unknown error"}) — not treated as sellable.`],
      approvalLinks: [],
      checkedAt: new Date().toISOString(),
      source: "error",
    };
  }
}

// Entry point used by API routes. Unconfigured SP-API -> UNKNOWN (honest),
// cached answers served within TTL.
export async function checkEligibility(
  cfg: SpApiConfig | null,
  asin: string,
  cache: EligibilityCache,
  fetchFn: FetchFn = fetch
): Promise<EligibilityResult> {
  if (!cfg) {
    return {
      state: "UNKNOWN",
      reasons: ["SP-API not configured for this account — eligibility not checked."],
      approvalLinks: [],
      checkedAt: new Date().toISOString(),
      source: "unconfigured",
    };
  }
  const cached = cache.get(cfg.sellerId, asin, cfg.marketplaceId);
  if (cached) return cached;
  const live = await checkEligibilityLive(cfg, asin, fetchFn);
  cache.set(cfg.sellerId, asin, cfg.marketplaceId, live);
  return live;
}
