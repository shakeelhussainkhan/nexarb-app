// Offline harness for WS4: Buy Box list-price suggestions + auto-reprice stub.
// Run: node scripts/verify-ws4-pricing.mjs
// (Node >= 23 strips the TS types in lib/engine/*.ts automatically.)
import {
  suggestListPrice,
  suggestListPriceFromEvaluation,
  recordPriceMonitor,
  maybeAutoreprice,
} from "../lib/engine/repricing.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. Normal case: suggested = buybox - $0.01, inside the corridor.
const normal = suggestListPrice({ buyBoxPrice: 24.99, floorPrice: 20.15, channel: "amazon" });
check(
  "normal case suggests penny under buy box",
  normal.suggested !== null && near(normal.suggested, 24.98, 0.001),
  JSON.stringify(normal)
);
check(
  "ceiling is buybox * 1.5",
  near(normal.ceiling, 24.99 * 1.5, 0.01) && near(normal.floor, 20.15, 0.001),
  JSON.stringify(normal)
);

// 2. Floor clamp: undercut would pierce the floor but buy box is viable -> hold at floor.
const clamped = suggestListPrice({ buyBoxPrice: 20.16, floorPrice: 20.15, channel: "amazon" });
check(
  "floor clamp: penny-under hits floor, suggestion held at floor",
  clamped.suggested !== null && near(clamped.suggested, 20.15, 0.001),
  JSON.stringify(clamped)
);

// 3. Buy box below floor -> null, do-not-list reasoning.
const belowFloor = suggestListPrice({ buyBoxPrice: 19.99, floorPrice: 20.15, channel: "amazon" });
check(
  "buybox below floor -> null with do-not-list reasoning",
  belowFloor.suggested === null && /below break-even — do not list/.test(belowFloor.reasoning),
  JSON.stringify(belowFloor)
);

// 4. Null buy box -> null with no-data reasoning.
const noBuyBox = suggestListPrice({ buyBoxPrice: null, floorPrice: 20.15, channel: "amazon" });
check(
  "null buybox -> null with no-data reasoning",
  noBuyBox.suggested === null && /no buy box data/.test(noBuyBox.reasoning),
  JSON.stringify(noBuyBox)
);

// 5. Structural per-channel evaluation shape accepted (sibling verdict.ts work).
const fromEval = suggestListPriceFromEvaluation(
  { sellPrice: 24.99, floorPrice: 20.15, netProfit: 1.20 },
  "amazon"
);
check(
  "per-channel evaluation shape produces the same suggestion",
  fromEval.suggested !== null && near(fromEval.suggested, 24.98, 0.001),
  JSON.stringify(fromEval)
);

// 6. recordPriceMonitor: inserts the right row, never throws.
const seen = [];
const fakeAdmin = {
  from: (table) => ({
    insert: (values) => {
      seen.push({ table, values });
      return Promise.resolve({ error: null });
    },
  }),
};
const logged = await recordPriceMonitor(fakeAdmin, {
  asin: "B012345678",
  channel: "amazon",
  ourPrice: 24.98,
  buyBoxPrice: 24.99,
});
check("price monitor insert ok", logged.ok === true, JSON.stringify(logged));
check(
  "price monitor writes expected columns",
  seen.length === 1 &&
    seen[0].table === "price_monitor" &&
    seen[0].values.asin === "B012345678" &&
    seen[0].values.channel === "amazon" &&
    seen[0].values.our_price === 24.98 &&
    seen[0].values.buy_box_price === 24.99 &&
    typeof seen[0].values.checked_at === "string",
  JSON.stringify(seen)
);
const failingAdmin = {
  from: () => ({
    insert: () => Promise.resolve({ error: { message: "boom" } }),
  }),
};
const failed = await recordPriceMonitor(failingAdmin, {
  asin: "B0X", channel: "amazon", ourPrice: null, buyBoxPrice: 10,
});
check(
  "price monitor surfaces insert failure without throwing",
  failed.ok === false && failed.error === "boom",
  JSON.stringify(failed)
);

// 7. Auto-reprice stub: always skips, with the would-do price in the reason.
const skip1 = await maybeAutoreprice({
  watchlistRow: { asin: "B012345678", autoreprice_enabled: false },
  suggestedPrice: 24.98,
});
check(
  "autoreprice stub skips and names the would-have-set price",
  skip1.action === "skipped" &&
    /auto-reprice disabled pending founder-approved bounds — would have set \$24\.98/.test(skip1.reason),
  JSON.stringify(skip1)
);

// Bounds present but outside them still skips (would have held at bound).
const skip2 = await maybeAutoreprice({
  watchlistRow: {
    asin: "B012345678",
    autoreprice_enabled: true,
    price_min: 18.0,
    price_max: 24.0,
  },
  suggestedPrice: 24.98,
});
check(
  "autoreprice stub skips even with bounds present (would have held at max)",
  skip2.action === "skipped" &&
    /would have set \$24\.98/.test(skip2.reason) &&
    /price_max \$24\.00/.test(skip2.reason),
  JSON.stringify(skip2)
);

// Never touches SP-API: repricing.ts must not import any SP-API module.
const src = await (await import("node:fs")).promises.readFile(
  new URL("../lib/engine/repricing.ts", import.meta.url),
  "utf8"
);
check(
  "repricing.ts has no SP-API imports",
  !/spapi|setListingsPrice|listingsItem/i.test(src),
  "found a SP-API reference in repricing.ts"
);
check(
  "founder-approval guard comment present",
  /REQUIRES FOUNDER-APPROVED BOUNDS/.test(src),
  "guard comment missing"
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
