// Server wiring for API-key-or-session auth (see lib/auth/apiKeyCore.ts for
// the decision rules). Endpoints used by cron automation call resolveUser()
// instead of Clerk's auth() directly, so they accept EITHER a signed-in
// browser session OR a personal API key in the X-NexArb-Key header.
//
// The mobile app authenticates with the third form: its Clerk session
// token in an Authorization: Bearer header (native apps hold no cookies,
// and the personal API key must never ship inside an app binary). The
// token is verified with Clerk's official backend verification —
// networkless when CLERK_JWT_KEY (the instance's JWT public key, from the
// Clerk dashboard) is configured, otherwise via the instance JWKS fetched
// with CLERK_SECRET_KEY — and a verified token resolves exactly like a
// browser session (see apiKeyCore rule 2).

import { auth } from "@clerk/nextjs/server";
import { verifyToken } from "@clerk/backend";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  bearerTokenFromHeader,
  decideAuth,
  type AuthOutcome,
  type KeyLookupResult,
} from "./apiKeyCore";

export type { AuthOutcome };

/**
 * Verify a Clerk session token presented as a Bearer credential.
 * Returns the token's subject (the Clerk user id), or null when the token
 * does not verify or no verification key is configured.
 */
async function verifyClerkBearerToken(token: string): Promise<string | null> {
  const jwtKey = process.env.CLERK_JWT_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!jwtKey && !secretKey) return null;
  try {
    const payload = await verifyToken(token, {
      ...(jwtKey ? { jwtKey } : {}),
      ...(secretKey ? { secretKey } : {}),
    });
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the caller identity for a request.
 * Returns an AuthOutcome — check `kind === "identity"` before proceeding.
 */
export async function resolveUser(req: { headers: Headers }): Promise<AuthOutcome> {
  const presented = req.headers.get("x-nexarb-key");
  const bearer = bearerTokenFromHeader(req.headers.get("authorization"));
  return decideAuth(
    presented,
    {
      lookupKeyByHash: async (hash: string) => {
        const { data, error } = await getSupabaseAdmin()
          .from("api_keys")
          .select("id, user_id, revoked_at")
          .eq("key_hash", hash)
          .single();
        if (error || !data) return null;
        return data as KeyLookupResult;
      },
      sessionUserId: async () => {
        const { userId } = await auth();
        return userId ?? null;
      },
      verifyBearerToken: verifyClerkBearerToken,
      onKeyUsed: (keyId: string) => {
        // Audit touch only — never blocks or fails the request.
        void getSupabaseAdmin()
          .from("api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", keyId)
          .then(
            () => undefined,
            () => undefined
          );
      },
    },
    bearer
  );
}
