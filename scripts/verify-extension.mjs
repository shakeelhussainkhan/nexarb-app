// Offline harness for the Chrome extension v1 pure logic.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-extension.mjs
// Pure-logic tests — NO network, NO database.
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  isPlausibleApiKey,
  API_KEY_PREFIX,
} from "@/lib/extension/keys.ts";
import {
  checkRateLimit,
  resetRateLimits,
  RATE_LIMIT_MAX,
} from "@/lib/extension/rateLimit.ts";
import {
  asinFromUrl,
  isAmazonHost,
  maxProfitableBuyPrice,
  outcomeForBuyPrice,
  EXTENSION_TARGET_MARGIN_PCT,
} from "@/lib/extension/analysis.ts";

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

// --- ASIN extraction -------------------------------------------------------
check("asin: /dp/ url", asinFromUrl("https://www.amazon.com/dp/B0CXYZ1234") === "B0CXYZ1234");
check(
  "asin: /dp/ with slug + query",
  asinFromUrl("https://www.amazon.com/Some-Product/dp/B0CXYZ1234/ref=sr_1_1?x=1") === "B0CXYZ1234"
);
check(
  "asin: /gp/product/",
  asinFromUrl("https://www.amazon.com/gp/product/B0CXYZ1234") === "B0CXYZ1234"
);
check(
  "asin: lowercase normalized",
  asinFromUrl("https://www.amazon.com/dp/b0cxyz1234") === "B0CXYZ1234"
);
check("asin: non-product page → null", asinFromUrl("https://www.amazon.com/gp/cart/view.html") === null);
check("asin: empty → null", asinFromUrl("") === null);
check("asin: 9-char → null", asinFromUrl("https://www.amazon.com/dp/B0CXYZ123") === null);

// --- host detection ---------------------------------------------------------
check("host: amazon.com", isAmazonHost("www.amazon.com"));
check("host: smile.amazon.com", isAmazonHost("smile.amazon.com"));
check("host: amazon.co.uk", isAmazonHost("amazon.co.uk"));
check("host: walmart.com rejected", !isAmazonHost("www.walmart.com"));
check("host: fakeamazon.com rejected", !isAmazonHost("fakeamazon.com"));

// --- max profitable buy price ----------------------------------------------
const mb1 = maxProfitableBuyPrice(25.0, "beauty");
check("maxBuy: positive and below sell", mb1 !== null && mb1 > 0 && mb1 < 25.0, String(mb1));
const mb2 = maxProfitableBuyPrice(50.0, "beauty");
check("maxBuy: monotonic in sell price", mb2 !== null && mb1 !== null && mb2 > mb1);
check("maxBuy: null on bad sell price", maxProfitableBuyPrice(0) === null);
check("maxBuy: null on negative sell price", maxProfitableBuyPrice(-5) === null);
// Buying exactly at maxBuy should land ~ the target margin (self-consistency).
if (mb1 !== null) {
  const oc = outcomeForBuyPrice(25.0, mb1, "beauty");
  check(
    "maxBuy: self-consistent margin ≈ target",
    oc !== null && Math.abs(oc.marginPct - EXTENSION_TARGET_MARGIN_PCT) < 0.005,
    oc ? String(oc.marginPct) : "null"
  );
}
const oc1 = outcomeForBuyPrice(25.0, 10.0, "beauty");
check("outcome: profit positive on good buy", oc1 !== null && oc1.netProfit > 0, JSON.stringify(oc1));
const oc2 = outcomeForBuyPrice(25.0, 24.0, "beauty");
check("outcome: profit negative on bad buy", oc2 !== null && oc2.netProfit < 0, JSON.stringify(oc2));
check("outcome: null on bad input", outcomeForBuyPrice(0, 10) === null);

// --- API keys ---------------------------------------------------------------
const gen = generateApiKey();
check("keygen: prefix", gen.plaintext.startsWith(API_KEY_PREFIX));
check("keygen: hash is sha256 hex", /^[0-9a-f]{64}$/.test(gen.hash));
check("keygen: hash matches plaintext", hashApiKey(gen.plaintext) === gen.hash);
check("keygen: verify round-trip", verifyApiKey(gen.plaintext, gen.hash));
check("keygen: wrong key fails", !verifyApiKey(gen.plaintext + "x", gen.hash));
check("keygen: empty fails", !verifyApiKey("", gen.hash));
const gen2 = generateApiKey();
check("keygen: unique", gen.plaintext !== gen2.plaintext && gen.hash !== gen2.hash);
check("keygen: plausible shape", isPlausibleApiKey(gen.plaintext));
check("keygen: implausible rejected", !isPlausibleApiKey("sk_live_123") && !isPlausibleApiKey(""));

// --- rate limiter ------------------------------------------------------------
resetRateLimits();
let allowed = 0;
for (let i = 0; i < RATE_LIMIT_MAX; i++) {
  if (checkRateLimit("k1").allowed) allowed++;
}
check("ratelimit: 60 allowed", allowed === RATE_LIMIT_MAX, String(allowed));
const blocked = checkRateLimit("k1");
check("ratelimit: 61st blocked", !blocked.allowed && blocked.retryAfterSec > 0);
check("ratelimit: separate key unaffected", checkRateLimit("k2").allowed);
// Window expiry: jump past the window.
const future = checkRateLimit("k1", Date.now() + 61_000);
check("ratelimit: window resets", future.allowed);
resetRateLimits();
check("ratelimit: reset clears", checkRateLimit("k1").allowed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
