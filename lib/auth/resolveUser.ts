// Server wiring for API-key-or-session auth (see lib/auth/apiKeyCore.ts for
// the decision rules). Endpoints used by cron automation call resolveUser()
// instead of Clerk's auth() directly, so they accept EITHER a signed-in
// browser session OR a personal API key in the X-NexArb-Key header.

import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decideAuth, type AuthOutcome, type KeyLookupResult } from "./apiKeyCore";

export type { AuthOutcome };

/**
 * Resolve the caller identity for a request.
 * Returns an AuthOutcome — check `kind === "identity"` before proceeding.
 */
export async function resolveUser(req: { headers: Headers }): Promise<AuthOutcome> {
  const presented = req.headers.get("x-nexarb-key");
  return decideAuth(presented, {
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
  });
}
