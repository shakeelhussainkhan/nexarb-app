// Offline harness for the listings sync + reprice pure logic.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-listings.mjs
// Pure-logic tests — NO network, NO database.
import {
  validateRepriceBounds,
  dedupForUpsert,
  deriveBuyBoxState,
  marginAtPrice,
} from "@/lib/engine/listingSync.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// --- bound validation ------------------------------------------------------
check("bounds: valid price inside bounds", validateRepriceBounds(19.99, 15, 25).ok);
check(
  "bounds: below floor refused with reason",
  (() => { const r = validateRepriceBounds(14.99, 15, 25); return !r.ok && r.reason.includes("$15.00"); })()
);
check(
  "bounds: above ceiling refused with reason",
  (() => { const r = validateRepriceBounds(25.01, 15, 25); return !r.ok && r.reason.includes("$25.00"); })()
);
check("bounds: no bounds configured passes", validateRepriceBounds(19.99, null, null).ok);
check("bounds: exact floor allowed", validateRepriceBounds(15, 15, 25).ok);
check("bounds: exact ceiling allowed", validateRepriceBounds(25, 15, 25).ok);
check(
  "bounds: zero price refused",
  !validateRepriceBounds(0, 15, 25).ok
);
check(
  "bounds: negative price refused",
  !validateRepriceBounds(-5, null, null).ok
);
check(
  "bounds: NaN refused",
  !validateRepriceBounds(NaN, null, null).ok
);
check(
  "bounds: only min set, high price passes",
  validateRepriceBounds(999, 15, null).ok
);

// --- sync upsert dedup ------------------------------------------------------
const rows = [
  { channel: "amazon", sellerSku: "SKU-1", asin: "A1", title: "old", ourPrice: 10, buyboxPrice: 12, buyboxWinner: true, offerCount: 3 },
  { channel: "amazon", sellerSku: "SKU-1", asin: "A1", title: "new", ourPrice: 11, buyboxPrice: 12, buyboxWinner: false, offerCount: 4 },
  { channel: "walmart", sellerSku: "SKU-1", asin: null, title: "wm", ourPrice: 9, buyboxPrice: null, buyboxWinner: null, offerCount: null },
];
const deduped = dedupForUpsert(rows);
check("dedup: same SKU collapses to one", deduped.length === 2, `got ${deduped.length}`);
check(
  "dedup: later row wins",
  deduped.find((r) => r.channel === "amazon")?.ourPrice === 11
);
check(
  "dedup: different channels kept separate",
  deduped.filter((r) => r.sellerSku === "SKU-1").length === 2
);

// --- win/lose derivation ----------------------------------------------------
check("buybox: true -> winning", deriveBuyBoxState(true) === "winning");
check("buybox: false -> losing", deriveBuyBoxState(false) === "losing");
check("buybox: null -> unknown", deriveBuyBoxState(null) === "unknown");

// --- margin math -------------------------------------------------------------
check(
  "margin: 29.99 - 12 - 8 = 9.99, 33.3%",
  (() => {
    const m = marginAtPrice(29.99, 12, 8);
    return m.netProfit === 9.99 && m.marginPct === 0.33;
  })()
);
check(
  "margin: null price -> nulls",
  (() => { const m = marginAtPrice(null, 12, 8); return m.netProfit === null && m.marginPct === null; })()
);
check(
  "margin: missing buy cost -> nulls",
  (() => { const m = marginAtPrice(29.99, null, 8); return m.netProfit === null && m.marginPct === null; })()
);
check(
  "margin: zero buy cost allowed (gifted stock)",
  (() => { const m = marginAtPrice(20, 0, 5); return m.netProfit === 15; })()
);
check(
  "margin: negative price -> nulls",
  (() => { const m = marginAtPrice(-5, 12, 8); return m.netProfit === null; })()
);
check(
  "margin: negative profit reported honestly",
  (() => { const m = marginAtPrice(10, 12, 8); return m.netProfit === -10 && m.marginPct === -1; })()
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
