// Pure auth-decision logic for API-key-or-session endpoints.
//
// Cron automation (discovery ingest, verification scan, checkout processor)
// cannot rely on a browser Clerk session — sessions expire and the browser
// profile is not durable. Those jobs authenticate with a personal API key
// (X-NexArb-Key header, same keys as the Chrome extension) instead.
//
// Decision rules (security-critical, keep exact):
//   1. If a plausible API key is presented, it decides alone: valid +
//      unrevoked → api-key identity; anything else → reject. NEVER fall
//      back to a session when a key was presented (a wrong key must not
//      silently ride on ambient cookies).
//   2. If no key is presented, fall back to the Clerk session.
//   3. API-key callers get a reduced action surface on the checkout
//      endpoint: they may report status (that's the processor's job) but
//      may NOT queue a checkout ("request") — queueing stays a deliberate
//      human action in the dashboard.
//
// This module is pure (lookup + session are injected) so it is unit-testable
// offline. The server wiring lives in lib/auth/resolveUser.ts.

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
  /** Fire-and-forget audit touch (last_used_at). Optional. */
  onKeyUsed?: (keyId: string) => void;
}

export async function decideAuth(
  presentedKey: string | null,
  deps: AuthDeps
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
  // not an auth attempt we recognize; the session decides.
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
