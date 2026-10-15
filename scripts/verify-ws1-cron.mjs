// Offline harness for workstream 1 (scheduled scans + Telegram BUY alerts).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-ws1-cron.mjs
// Covers:
//   - cronAuthStatus: valid secret -> 200, wrong secret -> 401,
//     missing header -> 401, CRON_SECRET unset -> 503 (never runs open)
//   - formatBuyAlertMessage: exact layout, HTML escaping, number formatting
import { cronAuthStatus } from "../lib/cron/auth.ts";
import { formatBuyAlertMessage, escapeHtml } from "../lib/telegram/alerts.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// --- cron auth ---
const env = { CRON_SECRET: "s3cr3t" };
const AUTH_GOOD = "Bearer " + env.CRON_SECRET;
const AUTH_BAD = "Bearer " + "wrong-value";
const AUTH_SAMELEN = "Bearer " + "x3cr3t";
check("valid bearer -> 200", cronAuthStatus(AUTH_GOOD, env) === 200);
check("wrong secret -> 401", cronAuthStatus(AUTH_BAD, env) === 401);
check("missing header -> 401", cronAuthStatus(null, env) === 401);
check("non-bearer header -> 401", cronAuthStatus("Basic abc", env) === 401);
check("secret unset -> 503", cronAuthStatus(AUTH_GOOD, {}) === 503);
check("secret unset, no header -> 503", cronAuthStatus(null, {}) === 503);
check(
  "same-length wrong secret -> 401 (timing-safe compare)",
  cronAuthStatus(AUTH_SAMELEN, env) === 401
);

// --- alert message formatting ---
const trace = {
  asin: "B012345678",
  qty: 10,
  title: "Sonic <b>Toothbrush</b> & Charger",
  inputs: {
    buyPrice: { value: 12.5, source: "founder-supplied", note: "" },
    sellPrice: { value: 29.99, source: "sp-api", reason: "", checkedAt: "" },
  },
  eligibility: { state: "SELLABLE", reasons: [], source: "sp-api", checkedAt: "" },
  verdict: {
    state: "BUY",
    reasons: [],
    floorPrice: 24.5,
    realisticPrice: 29.99,
    netProfitAtRealistic: 8.123,
    marginAtRealistic: 24.567,
    estMonthlySales: 100,
    velocityConfidence: "medium",
    daysToClear: 5,
    suggestedQty: 10,
  },
  guards: {
    wouldCreateIntent: false,
    reasons: [],
    caps: { dailySpendCap: 2500, perOrderCap: 1000, maxUnitsPerAsin: 20 },
    usage: { spentToday: 0, unitsForAsinToday: 0 },
    killSwitchOn: false,
  },
};

const msg = formatBuyAlertMessage(trace);
check("header uses title with HTML escaped", msg.includes("🟢 BUY SIGNAL — Sonic &lt;b&gt;Toothbrush&lt;/b&gt; &amp; Charger"), msg.split("\n")[0]);
check("buy/sell line formatted to cents", msg.includes("Buy $12.50 → Sell $29.99"), msg);
check("profit and margin formatted", msg.includes("Profit $8.12 (24.6%)"), msg);
check("ASIN line present", msg.includes("ASIN: B012345678"), msg);
check("dp link present", msg.includes("https://www.amazon.com/dp/B012345678"), msg);

// No title -> falls back to ASIN in the header.
const noTitle = { ...trace, title: undefined };
const msg2 = formatBuyAlertMessage(noTitle);
check("missing title falls back to ASIN", msg2.startsWith("🟢 BUY SIGNAL — B012345678"), msg2.split("\n")[0]);

// escapeHtml unit checks
check("escapeHtml escapes &<>", escapeHtml("a&b<c>d") === "a&amp;b&lt;c&gt;d");
check("escapeHtml passes plain text through", escapeHtml("plain 123") === "plain 123");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
