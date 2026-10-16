// Offline harness for the supplier pricing-pass selection policy
// (lib/suppliers/pricingCore.ts): the anti-livelock rules that replaced
// the first_seen_at queue. Before the fix, the pricing pass wrote
// nothing on a "no competitive prices" lookup, so the same offers were
// re-selected at the head of every call (processed=100 / priced +0
// forever, Frontier drain stuck at ~330 of 8,436 priced).
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-pricing-selection.mjs
// Pure-logic tests — NO network, NO database.
import {
  PRICE_ATTEMPT_MAX,
  PRICE_ATTEMPT_SPACING_MS,
  PRICE_SCAN_DEFAULT_CAP,
  PRICE_SCAN_MAX_CAP,
  pricingAttemptDue,
  pricingAttemptExhausted,
  pickPricingBatch,
} from "@/lib/suppliers/pricingCore.ts";

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

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const ids = (rows) => rows.map((r) => r.id).join(",");

// --- Policy constants -------------------------------------------------------
{
  check("constants: attempt budget is bounded", PRICE_ATTEMPT_MAX === 3);
  check("constants: spacing is 24h", PRICE_ATTEMPT_SPACING_MS === 24 * HOUR);
  check(
    "constants: default cap below hard cap",
    PRICE_SCAN_DEFAULT_CAP === 25 && PRICE_SCAN_MAX_CAP === 50
  );
}

// --- pricingAttemptDue ------------------------------------------------------
{
  check("due: never attempted", pricingAttemptDue({ priceAttempts: 0, priceAttemptedAt: null }, NOW));
  check(
    "due: attempted inside spacing gap → not due",
    !pricingAttemptDue({ priceAttempts: 1, priceAttemptedAt: iso(NOW - 1 * HOUR) }, NOW)
  );
  check(
    "due: attempted just past spacing gap → due",
    pricingAttemptDue({ priceAttempts: 1, priceAttemptedAt: iso(NOW - 25 * HOUR) }, NOW)
  );
  check(
    "due: attempted exactly at the gap boundary → due",
    pricingAttemptDue(
      { priceAttempts: 1, priceAttemptedAt: iso(NOW - PRICE_ATTEMPT_SPACING_MS) },
      NOW
    )
  );
  check(
    "due: budget left on last attempt still needs the gap",
    !pricingAttemptDue({ priceAttempts: PRICE_ATTEMPT_MAX - 1, priceAttemptedAt: iso(NOW - 2 * HOUR) }, NOW) &&
      pricingAttemptDue({ priceAttempts: PRICE_ATTEMPT_MAX - 1, priceAttemptedAt: iso(NOW - 25 * HOUR) }, NOW)
  );
  check(
    "due: exhausted budget is never due, however old",
    !pricingAttemptDue({ priceAttempts: PRICE_ATTEMPT_MAX, priceAttemptedAt: iso(NOW - 90 * 24 * HOUR) }, NOW)
  );
  check(
    "due: unparseable timestamp treated as due (retry, never wedge)",
    pricingAttemptDue({ priceAttempts: 1, priceAttemptedAt: "not-a-date" }, NOW)
  );
  check(
    "exhausted: at/over budget only",
    pricingAttemptExhausted({ priceAttempts: PRICE_ATTEMPT_MAX, priceAttemptedAt: null }) &&
      pricingAttemptExhausted({ priceAttempts: PRICE_ATTEMPT_MAX + 2, priceAttemptedAt: null }) &&
      !pricingAttemptExhausted({ priceAttempts: PRICE_ATTEMPT_MAX - 1, priceAttemptedAt: null })
  );
}

// --- pickPricingBatch: the livelock regression ------------------------------
{
  // Rows arrive pre-sorted least-recently-attempted first (the SQL
  // order). The head of the queue is two offers attempted an hour ago —
  // under the old selection these were re-picked on every call; the
  // batch must be filled from the fresh offers BEHIND them.
  const rows = [
    { id: "recent-1", priceAttempts: 1, priceAttemptedAt: iso(NOW - 1 * HOUR) },
    { id: "recent-2", priceAttempts: 1, priceAttemptedAt: iso(NOW - 1 * HOUR) },
    { id: "fresh-1", priceAttempts: 0, priceAttemptedAt: null },
    { id: "fresh-2", priceAttempts: 0, priceAttemptedAt: null },
    { id: "fresh-3", priceAttempts: 0, priceAttemptedAt: null },
  ];
  const batch = pickPricingBatch(rows, 2, NOW);
  check(
    "batch: spaced rows are skipped, batch fills from fresh offers",
    ids(batch) === "fresh-1,fresh-2",
    `got ${ids(batch)}`
  );
  check(
    "batch: cap respected, input order preserved",
    ids(pickPricingBatch(rows, 3, NOW)) === "fresh-1,fresh-2,fresh-3"
  );
  check("batch: cap 0 → empty", pickPricingBatch(rows, 0, NOW).length === 0);
  check("batch: empty input → empty", pickPricingBatch([], 25, NOW).length === 0);
  check(
    "batch: everything inside spacing → empty (the drain stop signal)",
    pickPricingBatch(rows.slice(0, 2), 25, NOW).length === 0
  );
  const mixed = [
    { id: "exhausted", priceAttempts: PRICE_ATTEMPT_MAX, priceAttemptedAt: iso(NOW - 40 * 24 * HOUR) },
    { id: "due-retry", priceAttempts: 2, priceAttemptedAt: iso(NOW - 30 * HOUR) },
    { id: "fresh", priceAttempts: 0, priceAttemptedAt: null },
  ];
  check(
    "batch: exhausted skipped, spaced-out retry picked before nothing",
    ids(pickPricingBatch(mixed, 25, NOW)) === "due-retry,fresh",
    `got ${ids(pickPricingBatch(mixed, 25, NOW))}`
  );
}

// --- Simulated drain: repeated calls over the whole pool --------------------
// Mirrors the lib: candidates sorted never-attempted first, then by
// last-attempt time; every picked offer is stamped (attempts + 1, at =
// now) as if its lookup returned no price. Proves (a) no offer is
// re-picked at the same instant — the old head-of-line block is gone,
// (b) retries wait for the spacing gap, and (c) once every offer is
// exhausted the batch comes back empty: the drain terminates.
{
  const pool = Array.from({ length: 6 }, (_, i) => ({
    id: `offer-${i + 1}`,
    priceAttempts: 0,
    priceAttemptedAt: null,
  }));
  const sorted = (rows) =>
    [...rows].sort((a, b) => {
      const ka = a.priceAttemptedAt ? Date.parse(a.priceAttemptedAt) : Number.NEGATIVE_INFINITY;
      const kb = b.priceAttemptedAt ? Date.parse(b.priceAttemptedAt) : Number.NEGATIVE_INFINITY;
      return ka - kb;
    });
  const runPass = (now) => {
    const batch = pickPricingBatch(sorted(pool), 2, now);
    for (const r of batch) {
      r.priceAttempts += 1;
      r.priceAttemptedAt = iso(now);
    }
    return batch;
  };

  let now = NOW;
  const p1 = runPass(now);
  const p2 = runPass(now);
  const p3 = runPass(now);
  const p4 = runPass(now);
  check(
    "drain: same-instant passes advance through the pool, never repeat",
    ids(p1) === "offer-1,offer-2" &&
      ids(p2) === "offer-3,offer-4" &&
      ids(p3) === "offer-5,offer-6",
    `got ${ids(p1)} | ${ids(p2)} | ${ids(p3)}`
  );
  check("drain: pool fully attempted at one instant → next pass empty", p4.length === 0);

  // Advance past the spacing gap repeatedly: each offer may be retried
  // once per gap until its budget is gone, then the drain ends.
  let guard = 0;
  let last = [];
  while (guard++ < 20) {
    now += PRICE_ATTEMPT_SPACING_MS + 1;
    last = runPass(now);
    if (last.length === 0) break;
  }
  check(
    "drain: retries are spaced, budget-bounded, and the drain terminates",
    last.length === 0 && pool.every((r) => r.priceAttempts === PRICE_ATTEMPT_MAX),
    `attempts: ${pool.map((r) => r.priceAttempts).join(",")}`
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
