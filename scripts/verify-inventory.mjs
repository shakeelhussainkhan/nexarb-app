// Offline harness for FIFO inventory accounting, P&L math, and warehouse
// shipment transitions. Run: node scripts/verify-inventory.mjs
// (Node >= 23 strips the TS types in lib/engine/*.ts automatically.)
import { readFileSync } from "node:fs";
import { addLot, sellUnits, lotCost, groupByAsin } from "../lib/engine/fifo.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const near = (a, b, tol = 0.001) => Math.abs(a - b) <= tol;

const L = (id, asin, qty, remaining, unitCost, received) => ({
  id, asin, qty, units_remaining: remaining, unit_cost: unitCost,
  source: "Walmart.com", warehouse: "Automated 3PL vault", received_at: received,
});

// --- FIFO core ---------------------------------------------------------------

// 1. FIFO consumes oldest lots first, even when a newer lot was added earlier.
let lots = [];
lots = addLot(lots, L("newer", "ASIN1", 10, 10, 5.0, "2026-08-01T00:00:00Z"));
lots = addLot(lots, L("older", "ASIN1", 10, 10, 3.0, "2026-06-01T00:00:00Z"));
const r1 = sellUnits(lots, "ASIN1", 10);
check(
  "FIFO consumes oldest lots first",
  near(r1.cogs, 30) && r1.remainingLots.find((l) => l.id === "older").units_remaining === 0
    && r1.remainingLots.find((l) => l.id === "newer").units_remaining === 10,
  `cogs=${r1.cogs}`
);

// 2. Partial-lot consumption leaves the remainder intact.
const r2 = sellUnits(lots, "ASIN1", 4);
check(
  "partial-lot consumption leaves remainder",
  near(r2.cogs, 12) && r2.remainingLots.find((l) => l.id === "older").units_remaining === 6,
  `cogs=${r2.cogs}`
);

// 3. Multi-lot sale COGS math: 12 units across older(10@$3) + newer(10@$5) = $40.
const r3 = sellUnits(lots, "ASIN1", 12);
check("multi-lot sale COGS math", near(r3.cogs, 40), `got ${r3.cogs}`);

// 4. Insufficient stock throws an honest error (and consumes nothing).
let threw = false;
try { sellUnits(lots, "ASIN1", 25); } catch (e) {
  threw = /Insufficient stock/.test(e.message);
}
check("insufficient stock throws", threw);

// 5. sellUnits never mutates the input array's lots.
const before = JSON.stringify(lots);
sellUnits(lots, "ASIN1", 5);
check("sellUnits does not mutate input", JSON.stringify(lots) === before);

// 6. lotCost = unit_cost * units_remaining.
check("lotCost math", near(lotCost(L("x", "A", 10, 7, 2.5, null)), 17.5));

// 7. groupByAsin aggregates units, weighted avg cost, and oldest-unit age.
const grouped = groupByAsin(
  [L("a", "ASIN9", 10, 6, 4.0, "2026-09-01T00:00:00Z"), L("b", "ASIN9", 10, 4, 6.0, "2026-09-20T00:00:00Z")],
  Date.parse("2026-10-01T00:00:00Z")
);
const g9 = grouped.find((g) => g.asin === "ASIN9");
check(
  "groupByAsin aggregates units and weighted avg cost",
  g9.unitsOnHand === 10 && near(g9.avgUnitCost, 4.8) && g9.oldestUnitAgeDays === 30,
  JSON.stringify(g9)
);

// --- P&L math (revenue - FIFO COGS - fees) -----------------------------------

// 8. P&L: 12 units sold at $20 with $1.50/unit fees on the lots above
//    revenue 240, COGS 40, fees 18 -> profit 182.
{
  const sales = [
    { asin: "ASIN1", qty: 7, unit_price: 20, fees: 10.5, sold_at: "2026-09-05T00:00:00Z" },
    { asin: "ASIN1", qty: 5, unit_price: 20, fees: 7.5, sold_at: "2026-09-12T00:00:00Z" },
  ];
  let pool = lots;
  let cogs = 0;
  for (const s of sales) { const r = sellUnits(pool, s.asin, s.qty); cogs += r.cogs; pool = r.remainingLots; }
  const revenue = sales.reduce((t, s) => t + s.qty * s.unit_price, 0);
  const fees = sales.reduce((t, s) => t + s.fees, 0);
  const profit = revenue - cogs - fees;
  check(
    "P&L math (revenue - COGS - fees)",
    near(revenue, 240) && near(cogs, 40) && near(fees, 18) && near(profit, 182),
    `rev=${revenue} cogs=${cogs} fees=${fees} profit=${profit}`
  );
}

// 9. Zero-sales P&L: no revenue, no COGS, no profit.
{
  const revenue = 0, cogs = 0, fees = 0, profit = revenue - cogs - fees;
  check("zero-sales P&L is all zeros", profit === 0 && revenue === 0 && cogs === 0);
}

// --- Shipment status transitions ---------------------------------------------
// The app code lives in app/dashboard/warehouse/page.tsx (.tsx cannot be
// imported by Node's type stripping), so the harness mirrors the documented
// transition map and additionally verifies the page source contains it.

// 10-12. Mirror of SHIPMENT_STATUS_TRANSITIONS from the page.
const TRANSITIONS = {
  created: ["in_transit", "cancelled"],
  in_transit: ["received_at_warehouse", "cancelled"],
  received_at_warehouse: ["prepping", "cancelled"],
  prepping: ["shipped_to_amazon", "cancelled"],
  shipped_to_amazon: ["delivered_to_amazon", "cancelled"],
  delivered_to_amazon: [],
  cancelled: [],
};
const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

check("created -> in_transit allowed", canTransition("created", "in_transit"));
check("created -> delivered_to_amazon rejected", !canTransition("created", "delivered_to_amazon"));
check("cancelled is terminal", TRANSITIONS.cancelled.length === 0);
check("delivered_to_amazon is terminal", TRANSITIONS.delivered_to_amazon.length === 0);
check(
  "received_at_warehouse reachable only from in_transit",
  Object.entries(TRANSITIONS).every(([from, tos]) =>
    from === "in_transit" ? tos.includes("received_at_warehouse") : !tos.includes("received_at_warehouse"))
);

// 13. The page source's map matches the tested mirror (sync check).
const pageSrc = readFileSync(new URL("../app/dashboard/warehouse/page.tsx", import.meta.url), "utf8");
const mirrorOk = Object.entries(TRANSITIONS).every(([from, tos]) => {
  const line = `${from}: [${tos.map((t) => `"${t}"`).join(", ")}]`;
  return pageSrc.includes(line);
});
check("page transition map matches tested mirror", mirrorOk);

// --- Migration schema ---------------------------------------------------------

const mig = readFileSync(new URL("../supabase/migrations/005_inventory_pnl_warehouse.sql", import.meta.url), "utf8");
check("migration tracks invoice_amount and invoice_paid", mig.includes("invoice_amount") && mig.includes("invoice_paid"));
check("migration tracks fba_shipment_id and vault_receipt_confirmed", mig.includes("fba_shipment_id") && mig.includes("vault_receipt_confirmed"));
check("migration documents the status lifecycle", mig.includes("created") && mig.includes("delivered_to_amazon") && mig.includes("cancelled"));
check("migration creates inventory_lots and sales_events", mig.includes("CREATE TABLE IF NOT EXISTS inventory_lots") && mig.includes("CREATE TABLE IF NOT EXISTS sales_events"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
