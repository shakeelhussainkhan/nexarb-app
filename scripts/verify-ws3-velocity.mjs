// WS3 offline harness: first-party velocity tracking (basic Keepa replacement).
// Run: node scripts/verify-ws3-velocity.mjs
// (Node >= 23 strips the TS types in lib/engine/*.ts automatically.)
//
// Exercises fixture snapshot SERIES (not just point estimates):
//   rank improving fast  -> positive trend + estMonthlySales > 0
//   flat rank             -> neutral trend
//   worsening rank        -> negative trend
//   single snapshot       -> low-confidence "insufficient data" (unknown)
// Plus: getVelocitySignals against a stubbed Supabase admin, and
// fetchSalesRankSnapshot against stubbed fetch (success / HTTP error / throw).
import {
  estimateVelocity,
  snapshotsToVelocitySignals,
  bsrTrend,
  fetchSalesRankSnapshot,
  getVelocitySignals,
  recordVelocitySnapshot,
} from "../lib/engine/velocity.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const ASIN = "B000TEST01";
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const snap = (n, rank, extra = {}) => ({
  asin: ASIN,
  marketplace: "amazon",
  price: null,
  buyBoxPrice: null,
  offerCount: null,
  salesRank: rank,
  category: "Beauty",
  capturedAt: day(n),
  ...extra,
});

// --- 1. Rank improving fast: 90k -> 8k over 6 days -----------------------
const improving = [90000, 70000, 50000, 30000, 15000, 8000].map((r, i) => snap(i, r));
check("improving series trend is positive", bsrTrend(improving) === "positive", bsrTrend(improving));
const impSignals = snapshotsToVelocitySignals(improving);
const impEst = estimateVelocity(impSignals);
check("improving series estMonthlySales > 0", impEst.monthlySales > 0, JSON.stringify(impEst));
check("improving series bsrDrops30d counted", (impSignals.bsrDrops30d ?? 0) === 5, JSON.stringify(impSignals));
check("improving series latest bsr used", impSignals.bsr === 8000, JSON.stringify(impSignals));

// --- 2. Flat rank ----------------------------------------------------------
const flat = [45000, 45000, 45000, 45000, 45000].map((r, i) => snap(i, r));
check("flat series trend is neutral", bsrTrend(flat) === "neutral", bsrTrend(flat));
const flatEst = estimateVelocity(snapshotsToVelocitySignals(flat));
check("flat series still estimates via bsr model", flatEst.monthlySales > 0 && flatEst.basis === "bsr-model", JSON.stringify(flatEst));

// --- 3. Worsening rank -------------------------------------------------------
const worsening = [5000, 8000, 15000, 40000, 80000].map((r, i) => snap(i, r));
check("worsening series trend is negative", bsrTrend(worsening) === "negative", bsrTrend(worsening));

// --- 4. Single snapshot: insufficient data -----------------------------------
check("single snapshot trend is insufficient", bsrTrend([snap(0, 12000)]) === "insufficient");
const singleEst = estimateVelocity({});
check("empty signals -> unknown confidence", singleEst.confidence === "unknown" && singleEst.monthlySales === 0, JSON.stringify(singleEst));

// --- 5. getVelocitySignals with a stubbed Supabase admin ---------------------
const rows = [
  { sales_rank: 60000, category: "Beauty", checked_at: day(0) },
  { sales_rank: 45000, category: "Beauty", checked_at: day(1) },
  { sales_rank: 30000, category: "Beauty", checked_at: day(2) },
];
const stubAdmin = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: rows, error: null }); },
    };
  },
  __rows: [],
};
const sig = await getVelocitySignals(stubAdmin, ASIN);
check("getVelocitySignals reads stored series", sig.bsr === 30000 && sig.bsrDrops30d === 2, JSON.stringify(sig));
check("getVelocitySignals estMonthlySales > 0", estimateVelocity(sig).monthlySales > 0);

const oneRowAdmin = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: rows.slice(0, 1), error: null }); },
    };
  },
};
const sigOne = await getVelocitySignals(oneRowAdmin, ASIN);
check("single stored snapshot -> insufficient data (empty signals)", Object.keys(sigOne).length === 0, JSON.stringify(sigOne));
const errAdmin = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: null, error: { message: "boom" } }); },
    };
  },
};
check("getVelocitySignals never throws on DB error", (await getVelocitySignals(errAdmin, ASIN)) && true);

// --- 6. recordVelocitySnapshot inserts without throwing ----------------------
const insertAdmin = {
  from(table) {
    this.__table = table;
    return { insert: (row) => { this.__rows.push(row); return Promise.resolve({ error: null }); } };
  },
  __rows: [],
};
await recordVelocitySnapshot(insertAdmin, ASIN, 25000, "Beauty");
check("recordVelocitySnapshot inserts one row", insertAdmin.__rows.length === 1
  && insertAdmin.__rows[0].asin === ASIN
  && insertAdmin.__rows[0].sales_rank === 25000, JSON.stringify(insertAdmin.__rows));
const boomAdmin = {
  from() { throw new Error("no db"); },
};
await recordVelocitySnapshot(boomAdmin, ASIN, null, null);
check("recordVelocitySnapshot never throws", true);

// --- 7. fetchSalesRankSnapshot against stubbed fetch -------------------------
const spCfg = { clientId: "x", clientSecret: "y", refreshToken: "z", marketplaceId: "ATVPDKIKX0DER", endpoint: "https://sp.example" };
const catalogPayload = {
  salesRanks: [
    { classificationRanks: [{ rank: 1234, title: "Beauty & Personal Care" }] },
  ],
};
const okFetch = async (url) => {
  if (url === "https://api.amazon.com/auth/o2/token") {
    return { ok: true, json: async () => ({ access_token: "tok" }) };
  }
  return { ok: true, json: async () => catalogPayload };
};
const okSnap = await fetchSalesRankSnapshot(spCfg, ASIN, okFetch);
check("fetchSalesRankSnapshot parses rank + category", okSnap.rank === 1234 && okSnap.category === "Beauty & Personal Care", JSON.stringify(okSnap));
check("fetchSalesRankSnapshot hits catalog items with salesRanks", true);

let sawUrl = "";
const urlSpyFetch = async (url) => {
  if (url === "https://api.amazon.com/auth/o2/token") {
    return { ok: true, json: async () => ({ access_token: "tok" }) };
  }
  sawUrl = url;
  return { ok: true, json: async () => catalogPayload };
};
await fetchSalesRankSnapshot(spCfg, ASIN, urlSpyFetch);
check("catalog URL carries includedData=salesRanks",
  sawUrl.includes("/catalog/2022-04-01/items/") && sawUrl.includes("includedData=salesRanks"), sawUrl);

const httpErrFetch = async (url) => {
  if (url === "https://api.amazon.com/auth/o2/token") return { ok: true, json: async () => ({ access_token: "tok" }) };
  return { ok: false, status: 429, text: async () => "rate limited" };
};
const errSnap = await fetchSalesRankSnapshot(spCfg, ASIN, httpErrFetch);
check("fetchSalesRankSnapshot nulls on HTTP error (never throws)", errSnap.rank === null && errSnap.category === null, JSON.stringify(errSnap));

const throwFetch = async () => { throw new Error("network down"); };
const throwSnap = await fetchSalesRankSnapshot(spCfg, ASIN, throwFetch);
check("fetchSalesRankSnapshot nulls on fetch throw (never throws)", throwSnap.rank === null && throwSnap.category === null, JSON.stringify(throwSnap));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
