// Offline harness for API-key-or-session auth (lib/auth/apiKeyCore.ts).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-api-key-auth.mjs
// Pure-logic tests — NO network, NO database. Lookup + session are fakes.
import { decideAuth, keyMayCheckoutAction } from "@/lib/auth/apiKeyCore.ts";
import { generateApiKey, hashApiKey } from "@/lib/extension/keys.ts";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

const { plaintext, hash } = generateApiKey();
const ROW = { id: "key-1", user_id: "user_shakeel", revoked_at: null };
const REVOKED = { id: "key-2", user_id: "user_shakeel", revoked_at: "2026-10-01T00:00:00Z" };

function deps({ row = null, session = null, lookupThrows = false, used = [] } = {}) {
  return {
    lookupKeyByHash: async (h) => {
      if (lookupThrows) throw new Error("db down");
      return h === hash ? row : null;
    },
    sessionUserId: async () => session,
    onKeyUsed: (id) => used.push(id),
  };
}

// --- Key path ---------------------------------------------------------------
{
  const used = [];
  const out = await decideAuth(plaintext, deps({ row: ROW, used }));
  check("valid key → api-key identity", out.kind === "identity" && out.via === "api-key" && out.userId === "user_shakeel");
  check("valid key → audit touch fired", used.length === 1 && used[0] === "key-1");
}
{
  const out = await decideAuth(plaintext, deps({ row: REVOKED, session: "user_shakeel" }));
  check("revoked key → reject (no session fallback)", out.kind === "reject");
}
{
  const out = await decideAuth(plaintext, deps({ row: null, session: "user_shakeel" }));
  check("unknown key → reject (no session fallback)", out.kind === "reject");
}
{
  const out = await decideAuth(plaintext, deps({ lookupThrows: true, session: "user_shakeel" }));
  check("lookup failure with key presented → reject", out.kind === "reject");
}
{
  const wrong = generateApiKey().plaintext;
  const out = await decideAuth(wrong, deps({ row: ROW, session: "user_shakeel" }));
  check("wrong key → reject even with live session", out.kind === "reject");
}

// --- Session path ------------------------------------------------------------
{
  const out = await decideAuth(null, deps({ session: "user_shakeel" }));
  check("no key + session → session identity", out.kind === "identity" && out.via === "session" && out.userId === "user_shakeel");
}
{
  const out = await decideAuth(null, deps({ session: null }));
  check("no key + no session → reject", out.kind === "reject");
}
{
  const out = await decideAuth("not-a-key", deps({ session: "user_shakeel" }));
  check("malformed key header ignored → session decides", out.kind === "identity" && out.via === "session");
}
{
  const out = await decideAuth("", deps({ session: null }));
  check("empty key + no session → reject", out.kind === "reject");
}

// --- Checkout action gate ------------------------------------------------------
check("session may request", keyMayCheckoutAction("session", "request") === true);
check("session may report status", keyMayCheckoutAction("session", "status") === true);
check("api-key may report status", keyMayCheckoutAction("api-key", "status") === true);
check("api-key may NOT request", keyMayCheckoutAction("api-key", "request") === false);
check("api-key unknown action denied", keyMayCheckoutAction("api-key", "approve") === false);
check("session unknown action denied", keyMayCheckoutAction("session", "approve") === false);

// --- Hash sanity (the SQL insert + lookup contract) ---------------------------
check("hash is deterministic sha256 hex", hashApiKey(plaintext) === hash && /^[0-9a-f]{64}$/.test(hash));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
