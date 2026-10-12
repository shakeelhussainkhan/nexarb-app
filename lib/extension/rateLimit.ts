// Simple in-memory per-key rate limiter for the extension API.
//
// 60 requests / rolling 60 seconds per API key. In-memory means the budget
// is per serverless instance — a determined caller behind many instances
// could exceed it, so this is abuse friction, not a security boundary.
// The API key itself is the real gate.

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSec: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

// keyId -> timestamps (ms) of recent allowed requests, oldest-first.
const buckets = new Map<string, number[]>();

export function checkRateLimit(keyId: string, nowMs = Date.now()): RateLimitResult {
  const cutoff = nowMs - WINDOW_MS;
  let hits = buckets.get(keyId) ?? [];
  // Drop expired entries.
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();

  if (hits.length >= MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((hits[0] + WINDOW_MS - nowMs) / 1000);
    buckets.set(keyId, hits);
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(retryAfterSec, 1) };
  }

  hits.push(nowMs);
  buckets.set(keyId, hits);
  return { allowed: true, remaining: MAX_REQUESTS - hits.length, retryAfterSec: 0 };
}

/** Test hook — clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

export const RATE_LIMIT_MAX = MAX_REQUESTS;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
