// Offline harness for the eligibility engine. Run: node scripts/verify-eligibility.mjs
import { evaluateRestrictions, EligibilityCache, checkEligibility, checkEligibilityLive } from "../lib/engine/eligibility.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

check("empty restrictions -> SELLABLE", evaluateRestrictions([]).state === "SELLABLE");
check("APPROVAL_REQUIRED maps through with link", (() => {
  const r = evaluateRestrictions([{ marketplaceId: "ATVPDKIKX0DER", reasons: [{ message: "Approval required", reasonCode: "APPROVAL_REQUIRED", links: [{ resource: "https://sellercentral.amazon.com/x", title: "Apply" }] }] }]);
  return r.state === "APPROVAL_REQUIRED" && r.approvalLinks.length === 1;
})());
check("NOT_ELIGIBLE -> BLOCKED", evaluateRestrictions([{ marketplaceId: "M", reasons: [{ message: "Not eligible", reasonCode: "NOT_ELIGIBLE" }] }]).state === "BLOCKED");
check("NOT_ELIGIBLE dominates APPROVAL_REQUIRED", evaluateRestrictions([{ marketplaceId: "M", reasons: [{ message: "a", reasonCode: "APPROVAL_REQUIRED" }, { message: "b", reasonCode: "NOT_ELIGIBLE" }] }]).state === "BLOCKED");
check("ASIN_NOT_FOUND -> UNKNOWN (never green)", evaluateRestrictions([{ marketplaceId: "M", reasons: [{ message: "nf", reasonCode: "ASIN_NOT_FOUND" }] }]).state === "UNKNOWN");
check("unconfigured -> UNKNOWN", (await checkEligibility(null, "B012345678", new EligibilityCache())).state === "UNKNOWN");

// Cache: clean lives 24h, restricted 3h, UNKNOWN never cached.
let t = 1_000_000;
const cache = new EligibilityCache(() => t);
const cfg = { refreshToken: "r", clientId: "c", clientSecret: "s", sellerId: "SELLER1", marketplaceId: "ATVPDKIKX0DER" };
const clean = evaluateRestrictions([]);
cache.set("SELLER1", "B012345678", "ATVPDKIKX0DER", clean);
t += 23 * 3600 * 1000;
check("clean cache hit at 23h", cache.get("SELLER1", "B012345678", "ATVPDKIKX0DER")?.state === "SELLABLE");
t += 2 * 3600 * 1000;
check("clean cache expired at 25h", cache.get("SELLER1", "B012345678", "ATVPDKIKX0DER") === undefined);

// Live check with a fake fetch: LWA token then restrictions payload.
const fakeFetch = async (url, init) => {
  if (String(url).includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
  if (String(url).includes("restrictions")) return { ok: true, json: async () => ({ restrictions: [] }) };
  return { ok: false, status: 404, json: async () => ({}) };
};
check("live check SELLABLE via fake fetch", (await checkEligibilityLive(cfg, "B012345678", fakeFetch)).state === "SELLABLE");

const failFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
const err = await checkEligibilityLive(cfg, "B012345678", failFetch);
check("live failure -> UNKNOWN, not SELLABLE", err.state === "UNKNOWN" && err.source === "error");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
