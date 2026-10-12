// Offline harness for the BSR → estimated-sales-per-day velocity model.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-sales-model.mjs
// Pure-logic tests — NO network, NO database.
import {
  estimateDailySales,
  rankTrend,
  normalizeCategory,
} from "@/lib/engine/salesModel.ts";
import {
  velocityReport,
  modelMonthlySales,
  confidenceForEvidence,
} from "@/lib/engine/velocity.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
function snaps(ranks, startDay = 0, dayStep = 1, category = "Electronics") {
  return ranks.map((r, i) => ({
    asin: "B000TEST",
    marketplace: "amazon",
    price: null,
    buyBoxPrice: null,
    offerCount: null,
    salesRank: r,
    category,
    capturedAt: new Date(Date.UTC(2026, 8, 1 + startDay + i * dayStep)).toISOString(),
  }));
}
function snapsHours(ranks, hours) {
  return ranks.map((r, i) => ({
    asin: "B000TEST",
    marketplace: "amazon",
    price: null,
    buyBoxPrice: null,
    offerCount: null,
    salesRank: r,
    category: "Electronics",
    capturedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, 0) + hours[i] * 3600 * 1000).toISOString(),
  }));
}

// --- Curve sanity -----------------------------------------------------------
const d1 = estimateDailySales(1, "electronics");
const d1000 = estimateDailySales(1000, "electronics");
check("rank 1 outsells rank 1000", d1.unitsPerDay > d1000.unitsPerDay,
  `${d1.unitsPerDay} vs ${d1000.unitsPerDay}`);

for (const cat of ["electronics", "beauty", "grocery", "books", "clothing", "sports & outdoors", "health & personal care", "pet supplies", "office products", "some-unknown-category"]) {
  const ranks = [1, 100, 1000, 10000, 100000, 500000];
  const vals = ranks.map((r) => estimateDailySales(r, cat).unitsPerDay);
  const mono = vals.every((v, i) => i === 0 || v < vals[i - 1]);
  const positive = vals.every((v) => v > 0);
  check(`monotonic decreasing + positive: ${cat}`, mono && positive, vals.join(","));
}

check("unknown category falls back to default curve",
  modelMonthlySales(10000, "zzz-nope") === modelMonthlySales(10000, "default"));

check("normalizeCategory: 'Home and Kitchen' -> 'home & kitchen'",
  normalizeCategory("Home and Kitchen") === "home & kitchen");
check("normalizeCategory trims + lowercases",
  normalizeCategory("  Toys & Games ") === "toys & games");
check("'Home and Kitchen' uses home & kitchen curve",
  estimateDailySales(10000, "Home and Kitchen").unitsPerDay ===
    estimateDailySales(10000, "home & kitchen").unitsPerDay);

// --- No fabricated figures ---------------------------------------------------
for (const bad of [0, -5, NaN, Infinity]) {
  const e = estimateDailySales(bad, "electronics");
  check(`invalid rank ${String(bad)} -> 0 units, not a guess`,
    e.unitsPerDay === 0 && /insufficient/i.test(e.basis),
    JSON.stringify(e));
}

// --- Confidence basis --------------------------------------------------------
check("model-only estimate is low confidence",
  estimateDailySales(5000, "beauty").confidence === "low");
check("2 snapshots / 1.2d -> medium",
  estimateDailySales(5000, "beauty", { snapshotCount: 2, spanDays: 1.2 }).confidence === "medium");
check("6 snapshots / 10d -> high",
  estimateDailySales(5000, "beauty", { snapshotCount: 6, spanDays: 10 }).confidence === "high");
check("3 snapshots / 0.5d -> low (thin span)",
  estimateDailySales(5000, "beauty", { snapshotCount: 3, spanDays: 0.5 }).confidence === "low");
check("confidenceForEvidence direct", confidenceForEvidence(5, 7) === "high" &&
  confidenceForEvidence(2, 1) === "medium" && confidenceForEvidence(1, 30) === "low");

// --- Trend classification ----------------------------------------------------
check("improving trend", rankTrend(snaps([9000, 7000, 5000], 0, 1)) === "improving");
check("declining trend", rankTrend(snaps([5000, 7000, 9000], 0, 1)) === "declining");
check("stable trend (flat)", rankTrend(snaps([5000, 5000, 5000], 0, 1)) === "stable");
check("stable trend (wiggle within tolerance)",
  rankTrend(snaps([5000, 5200, 4900], 0, 1)) === "stable");
check("single snapshot -> insufficient", rankTrend(snaps([5000])) === "insufficient");
check("no snapshots -> insufficient", rankTrend([]) === "insufficient");
check("span guard: 3 snapshots in 1 hour -> insufficient",
  rankTrend(snapsHours([9000, 7000, 5000], [0, 0.5, 1])) === "insufficient");
check("span guard respected when custom minSpanDays=0",
  rankTrend(snapsHours([9000, 7000, 5000], [0, 0.5, 1]), 0) === "improving");

// --- velocityReport -----------------------------------------------------------
const empty = velocityReport("B000X", []);
check("empty series -> null/unknown/insufficient",
  empty.unitsPerDay === null && empty.confidence === "unknown" &&
  empty.trend === "insufficient" && empty.snapshotCount === 0 &&
  /insufficient/i.test(empty.basis));

const one = velocityReport("B000X", snaps([5000]));
check("single snapshot -> null/unknown/insufficient",
  one.unitsPerDay === null && one.confidence === "unknown" &&
  one.trend === "insufficient" && one.snapshotCount === 1);

const full = velocityReport("B000X", snaps([9000, 7000, 5000], 0, 1, "Beauty"));
check("full series -> positive units, medium conf, improving",
  typeof full.unitsPerDay === "number" && full.unitsPerDay > 0 &&
  full.confidence === "medium" && full.trend === "improving" &&
  full.snapshotCount === 3 && full.spanDays === 2 && full.basis.length > 0,
  JSON.stringify(full));

const long = velocityReport("B000X", snaps([6000, 5900, 6100, 5950, 6050, 6000], 0, 2, "Books"));
check("6 snapshots over 10d -> high confidence, stable",
  long.confidence === "high" && long.trend === "stable" &&
  long.snapshotCount === 6 && long.spanDays === 10, JSON.stringify(long));

const unranked = velocityReport("B000X", snaps([null, undefined, 0], 0, 1));
check("unranked snapshots count as insufficient data",
  unranked.unitsPerDay === null && unranked.snapshotCount === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
