// Offline harness for the Featured Offer Expected Price module
// (lib/spapi/foepCore.ts + lib/spapi/foep.ts): batch request building,
// response parsing, gap math, and total-failure honesty.
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-foep.mjs
// Pure-logic tests — NO network, NO database. Fixtures follow Amazon's
// official Product Pricing v2022-05-01 model for
// getFeaturedOfferExpectedPriceBatch (request params flatten into each
// batch request item; per-item responses echo request.sku and carry a
// body with featuredOfferExpectedPriceResults / errors).
import {
  FOEP_BATCH_PATH,
  FOEP_MAX_SKUS,
  FOEP_REQUEST_URI,
  buildFoepBatchRequest,
  parseFoepBatchResponse,
  summarizeFoep,
} from "@/lib/spapi/foepCore.ts";
import { getFeaturedOfferExpectedPrices } from "@/lib/spapi/foep.ts";

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

const MP = "ATVPDKIKX0DER";
const CFG = {
  refreshToken: "rt",
  clientId: "cid",
  clientSecret: "cs",
  sellerId: "SELLER1",
  marketplaceId: MP,
};

// --- Request building --------------------------------------------------------
{
  const b = buildFoepBatchRequest(["SKU-A"], MP);
  const item = b.body.requests[0];
  check(
    "request item shape matches the official model (uri/method/flattened params)",
    item.uri === FOEP_REQUEST_URI &&
      item.method === "POST" &&
      item.marketplaceId === MP &&
      item.sku === "SKU-A" &&
      !("body" in item)
  );
  check("single sku not capped", b.capped === false && b.skus.length === 1);
}
{
  const b = buildFoepBatchRequest([" SKU-A ", "", "SKU-A", "SKU-B", "  "], MP);
  check(
    "trims, drops empties, dedupes in order",
    b.skus.join(",") === "SKU-A,SKU-B" && b.body.requests.length === 2
  );
}
{
  const many = Array.from({ length: FOEP_MAX_SKUS + 5 }, (_, i) => `SKU-${i}`);
  const b = buildFoepBatchRequest(many, MP);
  check(
    "caps at 40 requests and flags capped",
    b.body.requests.length === 40 && b.skus.length === 40 && b.capped === true
  );
  const exact = buildFoepBatchRequest(many.slice(0, FOEP_MAX_SKUS), MP);
  check("exactly 40 is not capped", exact.capped === false);
}

// --- Response parsing ----------------------------------------------------------
const FIXTURE = {
  responses: [
    {
      status: { statusCode: 200, reasonPhrase: "OK" },
      headers: {},
      request: { marketplaceId: MP, sku: "SKU-A" },
      body: {
        offerIdentifier: { marketplaceId: MP, asin: "B0TESTSKU1", sku: "SKU-A" },
        featuredOfferExpectedPriceResults: [
          {
            resultStatus: "VALID_FOEP",
            featuredOfferExpectedPrice: {
              listingPrice: { amount: 24.99, currencyCode: "USD" },
            },
            currentFeaturedOffer: {
              offerIdentifier: { marketplaceId: MP, asin: "B0TESTSKU1" },
              price: { listingPrice: { amount: 27.5, currencyCode: "USD" } },
            },
            competingFeaturedOffer: {
              offerIdentifier: { marketplaceId: MP, asin: "B0TESTSKU1" },
              price: { listingPrice: { amount: 26.99, currencyCode: "USD" } },
            },
          },
        ],
      },
    },
    {
      status: { statusCode: 200 },
      headers: {},
      request: { marketplaceId: MP, sku: "SKU-B" },
      body: {
        offerIdentifier: { marketplaceId: MP, asin: "B0TESTSKU2" },
        featuredOfferExpectedPriceResults: [{ resultStatus: "NO_COMPETING_OFFER" }],
      },
    },
    {
      status: { statusCode: 200 },
      headers: {},
      request: { marketplaceId: MP, sku: "SKU-C" },
      body: {
        offerIdentifier: { marketplaceId: MP, asin: "B0TESTSKU3" },
        featuredOfferExpectedPriceResults: [{ resultStatus: "OFFER_NOT_FOUND" }],
      },
    },
    {
      status: { statusCode: 404 },
      headers: {},
      request: { marketplaceId: MP, sku: "SKU-D" },
      body: { errors: [{ code: "InvalidInput", message: "The SKU was not found" }] },
    },
    {
      status: { statusCode: 200 },
      headers: {},
      request: { marketplaceId: MP, sku: "SKU-E" },
      body: {
        featuredOfferExpectedPriceResults: [
          { resultStatus: "VALID_FOEP", featuredOfferExpectedPrice: { listingPrice: { currencyCode: "USD" } } },
        ],
      },
    },
    {
      status: { statusCode: 200 },
      headers: {},
      request: { marketplaceId: MP, sku: "SKU-G" },
      body: {
        featuredOfferExpectedPriceResults: [{ resultStatus: "SOME_FUTURE_STATUS" }],
      },
    },
  ],
};
const ORDER = ["SKU-A", "SKU-B", "SKU-C", "SKU-D", "SKU-E", "SKU-F", "SKU-G"];
const parsed = parseFoepBatchResponse(FIXTURE, ORDER);
const bySku = Object.fromEntries(parsed.map((r) => [r.sku, r]));

check("one result per requested sku, request order preserved", parsed.map((r) => r.sku).join(",") === ORDER.join(","));
{
  const a = bySku["SKU-A"];
  check(
    "VALID_FOEP parses price, currency, asin, featured prices",
    a.expectedPrice === 24.99 &&
      a.currency === "USD" &&
      a.asin === "B0TESTSKU1" &&
      a.currentFeaturedPrice === 27.5 &&
      a.competingFeaturedPrice === 26.99 &&
      a.resultStatus === "VALID_FOEP" &&
      a.errorReason === null
  );
}
check(
  "NO_COMPETING_OFFER carries no price",
  bySku["SKU-B"].resultStatus === "NO_COMPETING_OFFER" && bySku["SKU-B"].expectedPrice === null
);
check(
  "OFFER_NOT_FOUND passes through with no price",
  bySku["SKU-C"].resultStatus === "OFFER_NOT_FOUND" && bySku["SKU-C"].expectedPrice === null
);
{
  const d = bySku["SKU-D"];
  check(
    "per-item HTTP failure surfaces status + Amazon's message",
    d.httpStatus === 404 && d.expectedPrice === null && (d.errorReason ?? "").includes("HTTP 404") && (d.errorReason ?? "").includes("not found")
  );
}
check(
  "VALID_FOEP without a numeric amount is NOT a price",
  bySku["SKU-E"].expectedPrice === null && (bySku["SKU-E"].errorReason ?? "").includes("no numeric price")
);
check(
  "requested sku missing from the batch is explicitly unavailable",
  bySku["SKU-F"].resultStatus === null && bySku["SKU-F"].expectedPrice === null && (bySku["SKU-F"].errorReason ?? "").includes("no response")
);
check(
  "unknown future resultStatus passes through untouched",
  bySku["SKU-G"].resultStatus === "SOME_FUTURE_STATUS" && bySku["SKU-G"].expectedPrice === null
);

// --- Summary / gap math ---------------------------------------------------------
{
  const s = summarizeFoep(bySku["SKU-A"], 29.99);
  check(
    "gap = our price - FOEP, with lower-by framing",
    s.state === "valid" && s.gap === 5 && s.gapText === "Lower by $5.00 to reach it"
  );
}
{
  const s = summarizeFoep(bySku["SKU-A"], 24.5);
  check(
    "at/under the win price reads in-range",
    s.state === "valid" && s.gap === -0.49 && s.gapText === "Your price is at or under the win price"
  );
}
{
  const s = summarizeFoep(bySku["SKU-A"], null);
  check("no our-price -> valid price, no gap", s.state === "valid" && s.expectedPrice === 24.99 && s.gap === null && s.gapText === null);
}
{
  const s = summarizeFoep(bySku["SKU-A"], 29.999);
  check("gap is cents-rounded", s.gap === 5.01);
}
check("NO_COMPETING_OFFER summarizes as its own honest state", summarizeFoep(bySku["SKU-B"], 10).state === "no-competition");
check("OFFER_NOT_FOUND summarizes unavailable with a reason", (() => { const s = summarizeFoep(bySku["SKU-C"], 10); return s.state === "unavailable" && s.note.includes("could not find"); })());
check("future status summarizes unavailable, never priced", summarizeFoep(bySku["SKU-G"], 10).state === "unavailable");

// --- Module behaviour with a fake fetch -----------------------------------------
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const okJson = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

{
  const ff = fakeFetch((url) =>
    url.includes("api.amazon.com/auth") ? okJson({ access_token: "tok-1" }) : okJson(FIXTURE)
  );
  const out = await getFeaturedOfferExpectedPrices(CFG, ["SKU-A", "SKU-B"], ff);
  const batchCall = ff.calls[1];
  const sentBody = JSON.parse(batchCall.init.body);
  check(
    "module: one LWA exchange + one batch POST with token header and model-shaped body",
    ff.calls.length === 2 &&
      batchCall.url.endsWith(FOEP_BATCH_PATH) &&
      batchCall.init.method === "POST" &&
      batchCall.init.headers["x-amz-access-token"] === "tok-1" &&
      sentBody.requests.length === 2 &&
      sentBody.requests[0].sku === "SKU-A" &&
      sentBody.requests[0].marketplaceId === MP &&
      out.reason === null &&
      out.results.find((r) => r.sku === "SKU-A")?.expectedPrice === 24.99
  );
}
{
  const ff = fakeFetch((url) =>
    url.includes("api.amazon.com/auth")
      ? okJson({ access_token: "tok-1" })
      : { ok: false, status: 500, json: async () => ({}), text: async () => "server exploded" }
  );
  const out = await getFeaturedOfferExpectedPrices(CFG, ["SKU-A", "SKU-B"], ff);
  check(
    "module: batch HTTP 500 -> every sku unavailable with the real reason, nothing invented",
    out.reason !== null &&
      out.reason.includes("500") &&
      out.results.length === 2 &&
      out.results.every((r) => r.expectedPrice === null && r.errorReason === out.reason)
  );
}
{
  const ff = fakeFetch(() => {
    throw new Error("socket hangup");
  });
  const out = await getFeaturedOfferExpectedPrices(CFG, ["SKU-A"], ff);
  check(
    "module: network throw -> unavailable with reason, never throws",
    out.results.length === 1 && out.results[0].expectedPrice === null && (out.reason ?? "").includes("socket hangup")
  );
}
{
  const out = await getFeaturedOfferExpectedPrices(CFG, [], fakeFetch(() => okJson({})));
  check("module: empty sku list short-circuits", out.results.length === 0 && out.reason === "No SKUs requested.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
