// Offline harness for discovery-at-scale: SP-API throttle, LWA token cache,
// raised caps, Costco adapter, and the multi-retailer registry.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-discovery-scale.mjs
// NO network: all fetch/clock/sleep are injected.
import {
  SpApiThrottle,
  isRetryableStatus,
  createTokenCache,
  getCachedAccessToken,
} from "../lib/sourcing/throttle.ts";
import {
  buildWatchlistPayload,
  MAX_NEW_WATCHLIST_ROWS,
  MAX_CANDIDATES_PER_INGEST,
} from "../lib/sourcing/orchestrate.ts";
import { retailerAdapters, getAdapter } from "../lib/sourcing/adapters.ts";
import {
  costcoAdapter,
  sweepCostcoDeals,
  parseCostcoSearchPayload,
  parseCostcoUpcFromProductPage,
} from "../lib/sourcing/costco.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// ---------------------------------------------------------------------------
// Fake clock + sleep for deterministic throttle tests
// ---------------------------------------------------------------------------
function fakeClock() {
  let t = 0;
  const slept = [];
  return {
    now: () => t,
    sleepFn: async (ms) => { slept.push(ms); t += ms; },
    slept,
  };
}

const res = (status, ok = status >= 200 && status < 300) => ({ ok, status });

// ---------------------------------------------------------------------------
// 1. isRetryableStatus
// ---------------------------------------------------------------------------
check("429 retryable", isRetryableStatus(429) === true);
check("503 retryable", isRetryableStatus(503) === true);
check("408 retryable", isRetryableStatus(408) === true);
check("400 not retryable", isRetryableStatus(400) === false);
check("403 not retryable", isRetryableStatus(403) === false);
check("200 not retryable", isRetryableStatus(200) === false);

// ---------------------------------------------------------------------------
// 2. Pacing: min interval between calls
// ---------------------------------------------------------------------------
{
  const c = fakeClock();
  const th = new SpApiThrottle({ minIntervalMs: 3000, now: c.now, sleepFn: c.sleepFn, jitterMs: 0 });
  const okFetch = async () => res(200);
  await th.fetch("https://x.test/1", {}, okFetch);
  await th.fetch("https://x.test/2", {}, okFetch);
  await th.fetch("https://x.test/3", {}, okFetch);
  check(
    "paces calls at min interval (first free, then 3000ms)",
    JSON.stringify(c.slept) === JSON.stringify([3000, 3000]),
    JSON.stringify(c.slept)
  );
}

// ---------------------------------------------------------------------------
// 3. 429 -> exponential backoff + retry, then success
// ---------------------------------------------------------------------------
{
  const c = fakeClock();
  const th = new SpApiThrottle({
    minIntervalMs: 3000, baseBackoffMs: 2000, jitterMs: 0,
    now: c.now, sleepFn: c.sleepFn,
  });
  let calls = 0;
  const flaky = async () => (++calls <= 2 ? res(429, false) : res(200));
  const out = await th.fetch("https://x.test/r", {}, flaky);
  check("429s retried until success", out.ok === true && calls === 3, `calls=${calls}`);
  check(
    "backoff sleeps grow exponentially (2000, then pace 1000, then 4000)",
    JSON.stringify(c.slept) === JSON.stringify([2000, 1000, 4000]),
    JSON.stringify(c.slept)
  );
}

// ---------------------------------------------------------------------------
// 4. Non-retryable status returns immediately, no retry
// ---------------------------------------------------------------------------
{
  const c = fakeClock();
  const th = new SpApiThrottle({ now: c.now, sleepFn: c.sleepFn, jitterMs: 0 });
  let calls = 0;
  const bad = async () => { calls++; return res(400, false); };
  const out = await th.fetch("https://x.test/b", {}, bad);
  check("400 returned without retry", out.status === 400 && calls === 1 && c.slept.length === 0);
}

// ---------------------------------------------------------------------------
// 5. Retries exhausted -> last response returned
// ---------------------------------------------------------------------------
{
  const c = fakeClock();
  const th = new SpApiThrottle({ maxRetries: 2, now: c.now, sleepFn: c.sleepFn, jitterMs: 0 });
  let calls = 0;
  const down = async () => { calls++; return res(500, false); };
  const out = await th.fetch("https://x.test/d", {}, down);
  check("gives up after maxRetries, returns 500", out.status === 500 && calls === 3, `calls=${calls}`);
}

// ---------------------------------------------------------------------------
// 6. Network throw -> retried, then recovers
// ---------------------------------------------------------------------------
{
  const c = fakeClock();
  const th = new SpApiThrottle({ now: c.now, sleepFn: c.sleepFn, jitterMs: 0 });
  let calls = 0;
  const flakyNet = async () => {
    calls++;
    if (calls === 1) throw new Error("socket hangup");
    return res(200);
  };
  const out = await th.fetch("https://x.test/n", {}, flakyNet);
  check("network throw retried, then success", out.ok === true && calls === 2);
}

// ---------------------------------------------------------------------------
// 7. LWA token cache: one exchange per run
// ---------------------------------------------------------------------------
{
  let tokenCalls = 0;
  const tokFetch = async (url) => {
    tokenCalls++;
    return { ok: true, json: async () => ({ access_token: "tok-1" }) };
  };
  const cfg = { refreshToken: "r", clientId: "c", clientSecret: "s" };
  const cache = createTokenCache();
  const t1 = await getCachedAccessToken(cfg, tokFetch, cache);
  const t2 = await getCachedAccessToken(cfg, tokFetch, cache);
  check("token cached across calls", t1 === "tok-1" && t2 === "tok-1" && tokenCalls === 1, `calls=${tokenCalls}`);
  cache.expiresAt = 0; // force expiry
  await getCachedAccessToken(cfg, tokFetch, cache);
  check("expired token refetched", tokenCalls === 2, `calls=${tokenCalls}`);
}

// ---------------------------------------------------------------------------
// 8. Raised caps
// ---------------------------------------------------------------------------
check("MAX_NEW_WATCHLIST_ROWS is 100", MAX_NEW_WATCHLIST_ROWS === 100);
check("MAX_CANDIDATES_PER_INGEST is 100", MAX_CANDIDATES_PER_INGEST === 100);

// ---------------------------------------------------------------------------
// 9. Dedup + cap at higher volume
// ---------------------------------------------------------------------------
{
  const many = [];
  for (let i = 0; i < 120; i++) many.push({ asin: `B${i}`, title: `T${i}`, buyPrice: 9.99 });
  for (let i = 0; i < 30; i++) many.push({ asin: `B${i}`, title: `Dup${i}`, buyPrice: 1.99 });
  const rows = buildWatchlistPayload(many, []);
  const asins = rows.map((r) => r.asin);
  check(
    "150 matches (30 dups) -> 100 unique rows, first wins",
    rows.length === 100 &&
      new Set(asins).size === 100 &&
      rows[0].title === "T0" &&
      rows[0].buy_price === 9.99,
    `got ${rows.length}`
  );
}

// ---------------------------------------------------------------------------
// 10. Per-retailer buy_source tagging
// ---------------------------------------------------------------------------
{
  const rows = buildWatchlistPayload(
    [{ asin: "B1", title: "T", buyPrice: 5 }],
    [],
    { buySource: "costco-clearance" }
  );
  check("buySource option flows to rows", rows[0].buy_source === "costco-clearance");
}

// ---------------------------------------------------------------------------
// 11. Adapter registry: walmart + costco
// ---------------------------------------------------------------------------
{
  const slugs = retailerAdapters.map((a) => a.slug);
  check("registry has walmart and costco", slugs.includes("walmart") && slugs.includes("costco"), slugs.join(","));
  check("getAdapter('costco') resolves", getAdapter("costco")?.displayName === "Costco");
  check("costcoAdapter implements sweep", typeof costcoAdapter.sweep === "function");
}

// ---------------------------------------------------------------------------
// 12. Costco sweep: blocked -> graceful, never throws
// ---------------------------------------------------------------------------
{
  const blockedFetch = async () => ({
    ok: false, status: 403, text: async () => "<html><body>Access Denied</body></html>",
  });
  let threw = false;
  let out = null;
  try {
    out = await sweepCostcoDeals({ fetchFn: blockedFetch, delayMs: 1 });
  } catch { threw = true; }
  check(
    "blocked costco -> no items, graceful error, no throw",
    !threw && out.items.length === 0 && out.errors.some((e) => /costco blocked/.test(e)),
    JSON.stringify(out?.errors)
  );

  const throwingFetch = async () => { throw new Error("boom"); };
  threw = false;
  try {
    out = await sweepCostcoDeals({ fetchFn: throwingFetch, delayMs: 1 });
  } catch { threw = true; }
  check("throwing fetch -> graceful error, no throw", !threw && out.errors.length > 0);
}

// ---------------------------------------------------------------------------
// 13. Costco JSON-LD parsing (fixtures, no network)
// ---------------------------------------------------------------------------
const searchHtml = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
  {"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Kirkland Widget 2-Pack","url":"/p/kirkland-widget-2-pack.product.12345.html","image":"https://img.costco.com/x.jpg","offers":{"@type":"Offer","price":19.99},"gtin13":"0012345678905"}},
  {"@type":"ListItem","position":2,"item":{"@type":"Product","name":"Costco Gift Card $50","url":"https://www.costco.com/gift-card.html","offers":{"@type":"Offer","price":50.00}}}
]}
<\/script></head><body></body></html>`;

{
  const products = parseCostcoSearchPayload(searchHtml);
  check(
    "parses products from JSON-LD ItemList, filters gift cards",
    products.length === 1 &&
      products[0].title === "Kirkland Widget 2-Pack" &&
      products[0].price === 19.99 &&
      products[0].url === "https://www.costco.com/p/kirkland-widget-2-pack.product.12345.html" &&
      products[0].upc === "0012345678905",
    JSON.stringify(products)
  );
  check("empty html -> no products", parseCostcoSearchPayload("<html></html>").length === 0);
}

{
  const upcHtml = `<html><head><script type="application/ld+json">{"@type":"Product","name":"X","gtin13":" 0012345678905 "}<\/script></head></html>`;
  check("extracts gtin13 from product page", parseCostcoUpcFromProductPage(upcHtml) === "0012345678905");
  check("no gtin -> null", parseCostcoUpcFromProductPage("<html></html>") === null);
}

// ---------------------------------------------------------------------------
// 14. Costco adapter stamps the retailer slug
// ---------------------------------------------------------------------------
{
  const okFetch = async (url) => {
    if (String(url).includes("CatalogSearch")) {
      return { ok: true, status: 200, text: async () => searchHtml };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  const out = await costcoAdapter.sweep({ fetchFn: okFetch, fetchUpc: false, delayMs: 1 });
  check(
    "adapter sweep returns candidates stamped retailer=costco",
    out.items.length === 1 && out.items[0].retailer === "costco",
    JSON.stringify(out.items.map((i) => i.retailer))
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
