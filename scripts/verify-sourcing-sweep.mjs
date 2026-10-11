// Offline harness for the discovery-sweep orchestration helper.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-sourcing-sweep.mjs
// Pure-logic tests for buildWatchlistPayload — NO network.
import {
  buildWatchlistPayload,
  SWEEP_BUY_SOURCE,
  MAX_NEW_WATCHLIST_ROWS,
} from "@/lib/sourcing/orchestrate.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const m = (asin, title = `Title ${asin}`, buyPrice = 9.99) => ({ asin, title, buyPrice });

// 1. Empty input -> empty payload
check(
  "empty matches -> empty payload",
  buildWatchlistPayload([], []).length === 0
);

// 2. Skips ASINs already on the watchlist
{
  const rows = buildWatchlistPayload(
    [m("B001"), m("B002"), m("B003")],
    new Set(["B001", "B003"])
  );
  check(
    "skips existing ASINs",
    rows.length === 1 && rows[0].asin === "B002",
    JSON.stringify(rows)
  );
}

// 3. Dedupes duplicate ASINs within the match list (first wins)
{
  const rows = buildWatchlistPayload(
    [m("B001", "First title", 10), m("B001", "Second title", 20), m("B002")],
    []
  );
  check(
    "dedupes duplicate ASINs, first wins",
    rows.length === 2 && rows[0].title === "First title" && rows[0].buy_price === 10,
    JSON.stringify(rows)
  );
}

// 4. Caps at 25 new rows per run
{
  const many = Array.from({ length: 60 }, (_, i) => m(`B${String(i).padStart(3, "0")}`));
  const rows = buildWatchlistPayload(many, []);
  check(
    "caps payload at 25 new rows",
    rows.length === 25 && MAX_NEW_WATCHLIST_ROWS === 25,
    `got ${rows.length}`
  );
}

// 5. Row fields map correctly (buy_source tag, active flag, category null)
{
  const rows = buildWatchlistPayload([m("B009", "Canopy", 89.99)], []);
  const r = rows[0];
  check(
    "row fields map correctly",
    r.asin === "B009" &&
      r.title === "Canopy" &&
      r.buy_price === 89.99 &&
      r.buy_source === "walmart-clearance" &&
      r.buy_source === SWEEP_BUY_SOURCE &&
      r.category === null &&
      r.active === true,
    JSON.stringify(r)
  );
}

// 6. Blank/whitespace ASINs are skipped, valid ones still land
{
  const rows = buildWatchlistPayload(
    [m(""), m("   "), m("B010")],
    []
  );
  check(
    "skips blank ASINs",
    rows.length === 1 && rows[0].asin === "B010",
    JSON.stringify(rows.map((r) => r.asin))
  );
}

// 7. Accepts a plain array (not just a Set) for existing ASINs
{
  const rows = buildWatchlistPayload([m("B011"), m("B012")], ["B011"]);
  check(
    "existing ASINs as plain array",
    rows.length === 1 && rows[0].asin === "B012",
    JSON.stringify(rows.map((r) => r.asin))
  );
}

// 8. Existing duplicates across the boundary: match ASIN equal to existing is
// skipped even when it also appears twice in matches
{
  const rows = buildWatchlistPayload(
    [m("B013"), m("B013"), m("B014")],
    new Set(["B013"])
  );
  check(
    "existing + duplicate combo skipped once",
    rows.length === 1 && rows[0].asin === "B014",
    JSON.stringify(rows.map((r) => r.asin))
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
