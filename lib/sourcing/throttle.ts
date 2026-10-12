// Polite SP-API calling for discovery: min-interval pacing, 429/5xx retry
// with exponential backoff + jitter, and an LWA access-token cache.
//
// Why this exists: discovery now matches up to 100 UPCs per run via
// SP-API Catalog Items searchByIdentifiers (~20 req/min on most
// marketplaces). Without pacing we'd burn the quota and get throttled;
// without backoff a single 429 would fail the run. Sequential + paced is
// the deliberate shape — never hammer the API.
//
// Pure except for the injected clock/sleep, so the offline harness can
// drive it deterministically.

export interface ThrottleOptions {
  /** Minimum ms between the start of consecutive calls. Default 3000 (~20/min). */
  minIntervalMs?: number;
  /** Retries after the first attempt on retryable failures. Default 3. */
  maxRetries?: number;
  /** Base backoff ms; actual wait is base * 2^attempt + jitter. Default 2000. */
  baseBackoffMs?: number;
  /** Max random jitter ms added to each backoff. Default 1000. */
  jitterMs?: number;
  /** Injectable clock (ms). Default Date.now. */
  now?: () => number;
  /** Injectable sleep. Default setTimeout. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** 429 / 408 / 5xx are worth retrying; 4xx (auth, bad request) are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SpApiThrottle {
  private lastCallAt: number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly jitterMs: number;
  private readonly now: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(opts?: ThrottleOptions) {
    this.minIntervalMs = opts?.minIntervalMs ?? 3000;
    this.maxRetries = opts?.maxRetries ?? 3;
    this.baseBackoffMs = opts?.baseBackoffMs ?? 2000;
    this.jitterMs = opts?.jitterMs ?? 1000;
    this.now = opts?.now ?? Date.now;
    this.sleepFn = opts?.sleepFn ?? defaultSleep;
    this.lastCallAt = Number.NEGATIVE_INFINITY;
  }

  /** Wait until minIntervalMs has elapsed since the previous call started. */
  async pace(): Promise<void> {
    const wait = this.minIntervalMs - (this.now() - this.lastCallAt);
    if (wait > 0) await this.sleepFn(wait);
    this.lastCallAt = this.now();
  }

  private async backoff(attempt: number): Promise<void> {
    const jitter = Math.random() * this.jitterMs;
    await this.sleepFn(this.baseBackoffMs * 2 ** attempt + jitter);
  }

  /**
   * Run one fetch with pacing + retry. HTTP statuses never throw: the final
   * Response (ok or not) is returned after retries are exhausted.
   * Network-level throws from innerFetch are retried too, then rethrown
   * after maxRetries.
   */
  async fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
    innerFetch: typeof fetch = fetch
  ): Promise<Response> {
    let attempt = 0;
    for (;;) {
      await this.pace();
      let res: Response;
      try {
        res = await innerFetch(input, init);
      } catch (e) {
        if (attempt >= this.maxRetries) throw e;
        await this.backoff(attempt);
        attempt++;
        continue;
      }
      if (!isRetryableStatus(res.status) || attempt >= this.maxRetries) {
        return res;
      }
      await this.backoff(attempt);
      attempt++;
    }
  }
}

// ---------------------------------------------------------------------------
// LWA access-token cache
// ---------------------------------------------------------------------------
//
// matchUpcToAsin used to exchange a fresh LWA token per UPC lookup — at
// 100 lookups/run that's 100 wasted token exchanges. Tokens live 3600s;
// cache them for 3500s. One cache is created per sweep/ingest run and
// passed through; callers that pass no cache keep the old per-call
// behavior (the existing matcher harness depends on it).

export interface TokenCache {
  token: string | null;
  expiresAt: number; // ms, per Date.now()
}

export function createTokenCache(): TokenCache {
  return { token: null, expiresAt: 0 };
}

const TOKEN_TTL_MS = 3_500_000; // 3500s, just under the 3600s LWA lifetime

export async function getCachedAccessToken(
  cfg: { refreshToken: string; clientId: string; clientSecret: string },
  fetchFn: typeof fetch,
  cache: TokenCache,
  now: () => number = Date.now
): Promise<string> {
  if (cache.token && now() < cache.expiresAt) return cache.token;
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
  cache.token = data.access_token;
  cache.expiresAt = now() + TOKEN_TTL_MS;
  return cache.token;
}
