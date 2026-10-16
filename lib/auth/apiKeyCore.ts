// Pure auth-decision logic for API-key-or-session endpoints.
//
// Cron automation (discovery ingest, verification scan, checkout processor)
// cannot rely on a browser Clerk session — sessions expire and the browser
// profile is not durable. Those jobs authenticate with a personal API key
// (X-NexArb-Key header, same keys as the Chrome extension) instead.
//
// The mobile app has the opposite problem: it holds a real Clerk session
// but has no cookies and must never embed a personal API key. It sends the
// Clerk session token as an Authorization: Bearer header instead, and a
// verified token is treated exactly as a session.
//
// Decision rules (security-critical, keep exact):
//   1. If a plausible API key is presented, it decides alone: valid +
//      unrevoked → api-key identity; anything else → reject. NEVER fall
//      back to a session when a key was presented (a wrong key must not
//      silently ride on ambient cookies).
//   2. If a Bearer token is presented, it decides alone too: verified →
//      session identity; unverifiable (bad signature, expired, verifier
//      down or not configured) → reject. A bad token must not silently
//      ride on ambient cookies either.
//   3. If neither credential is presented, fall back to the Clerk
//      cookie session.
//   4. API-key callers get a reduced action surface on the checkout
//      endpoint: they may report status (that's the processor's job) but
//      may NOT queue a checkout ("request") — queueing stays a deliberate
//      human action in the dashboard. Bearer callers are sessions, so
//      they keep the full session surface.
//
// This module is pure (lookup + session + token verification are injected)
// so it is unit-testable offline. The server wiring lives in
// lib/auth/resolveUser.ts.

import { hashApiKey, isPlausibleApiKey } from "../extension/keys";

export interface KeyLookupResult {
  id: string;
  user_id: string;
  revoked_at: string | null;
}

export type AuthOutcome =
  | { kind: "identity"; userId: string; via: "api-key"; keyId: string }
  | { kind: "identity"; userId: string; via: "session" }
  | { kind: "reject" };

export interface AuthDeps {
  /** Look up an api_keys row by its SHA-256 hash. Null when not found. */
  lookupKeyByHash: (hash: string) => Promise<KeyLookupResult | null>;
  /** Current Clerk session user id, or null when signed out. */
  sessionUserId: () => Promise<string | null>;
  /**
   * Verify a Clerk session token presented as a Bearer credential.
   * Returns the token's user id (sub), or null when the token does not
   * verify. Optional: when no verifier is wired, a presented Bearer token
   * cannot be trusted and is rejected.
   */
  verifyBearerToken?: (token: string) => Promise<string | null>;
  /** Fire-and-forget audit touch (last_used_at). Optional. */
  onKeyUsed?: (keyId: string) => void;
}

/**
 * Extract the token from an Authorization header. Returns null for a
 * missing header, a non-Bearer scheme, or an empty token — those are "no
 * Bearer credential presented", not a failed verification.
 */
export function bearerTokenFromHeader(
  authorization: string | null | undefined
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export async function decideAuth(
  presentedKey: string | null,
  deps: AuthDeps,
  presentedBearer: string | null = null
): Promise<AuthOutcome> {
  if (isPlausibleApiKey(presentedKey)) {
    let row: KeyLookupResult | null = null;
    try {
      row = await deps.lookupKeyByHash(hashApiKey(presentedKey));
    } catch {
      return { kind: "reject" };
    }
    if (!row || row.revoked_at) return { kind: "reject" };
    deps.onKeyUsed?.(row.id);
    return { kind: "identity", userId: row.user_id, via: "api-key", keyId: row.id };
  }

  // A malformed key header (present but not plausible) is ignored — it is
  // not an auth attempt we recognize; the Bearer token, then the session,
  // decide.
  if (presentedBearer) {
    if (!deps.verifyBearerToken) return { kind: "reject" };
    let bearerUserId: string | null = null;
    try {
      bearerUserId = await deps.verifyBearerToken(presentedBearer);
    } catch {
      return { kind: "reject" };
    }
    if (!bearerUserId) return { kind: "reject" };
    return { kind: "identity", userId: bearerUserId, via: "session" };
  }

  let userId: string | null = null;
  try {
    userId = await deps.sessionUserId();
  } catch {
    return { kind: "reject" };
  }
  if (!userId) return { kind: "reject" };
  return { kind: "identity", userId, via: "session" };
}

/** Checkout endpoint action gate: api-key callers may only report status. */
export function keyMayCheckoutAction(
  via: "api-key" | "session",
  action: string
): boolean {
  if (via === "session") return action === "request" || action === "status";
  return action === "status";
}
