// Offline harness for Money module PR-B core (lib/inventory/lotsCore.ts).
// Run: node scripts/verify-lots.mjs
// Pure-logic tests — NO network, NO database. Imports the core directly
// (Node 23 strips types); the core has no imports of its own. The fifo
// import proves the payload satisfies the InventoryLot contract that
// /dashboard/pnl consumes.
import {
  roundUnitCost,
  landedUnitCost,
  isDeliveredStatus,
  alibabaLotSource,
  purchaseLotSource,
  buildAlibabaOrderLot,
  buildPurchaseIntentLot,
} from "../lib/inventory/lotsCore.ts";
import { addLot, lotCost, sellUnits } from "../lib/engine/fifo.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const approx = (a, b, tol = 0.005) => Math.abs(a - b) < tol;

// 1. Landed unit cost: order total / qty, 4dp so unit x qty ~= total.
check("landedUnitCost: live cubes order $1,333.11 / 350 = 3.8089",
  landedUnitCost(1333.11, 350) === 3.8089);
check("landedUnitCost: unit x qty reproduces the total to the cent",
  approx(landedUnitCost(1333.11, 350) * 350, 1333.11, 0.02));
check("landedUnitCost: exact division stays exact", landedUnitCost(100, 4) === 25);
check("landedUnitCost: repeating division rounds to 4dp", landedUnitCost(10, 3) === 3.3333);
check("landedUnitCost: null for unusable qty/total",
  landedUnitCost(100, 0) === null && landedUnitCost(100, -2) === null
  && landedUnitCost(100, 2.5) === null && landedUnitCost(-5, 10) === null
  && landedUnitCost(Number.NaN, 10) === null);
check("roundUnitCost: 4dp rounding", roundUnitCost(3.80888571) === 3.8089 && roundUnitCost(19.99) === 19.99);

// 2. Delivered-only gating: nothing in transit may become a lot.
check("gate: delivered passes", isDeliveredStatus("delivered") === true);
check("gate: every non-delivered status is refused",
  ["draft", "pending_approval", "approved", "ready_to_place", "awaiting_payment",
   "placed", "shipped", "failed", "cancelled"].every((s) => !isDeliveredStatus(s)));

// 3. Alibaba lot payload: exact fifo contract + marker + 3PL warehouse.
const cubesOrder = {
  ref: "AO-MVA1QI1I-1", targetAsin: "B081NZ4YMH", qty: 350,
  orderTotal: 1333.11, updatedAt: "2026-11-20T15:04:00.000Z",
};
const cubesLot = buildAlibabaOrderLot(cubesOrder);
check("alibaba lot: payload shape matches the InventoryLot contract", (() => {
  if (!cubesLot) return false;
  const keys = Object.keys(cubesLot).sort();
  return JSON.stringify(keys) === JSON.stringify(
    ["asin", "qty", "received_at", "source", "unit_cost", "units_remaining", "warehouse"])
    && cubesLot.asin === "B081NZ4YMH" && cubesLot.qty === 350
    && cubesLot.units_remaining === 350 && cubesLot.unit_cost === 3.8089
    && cubesLot.warehouse === "Automated 3PL"
    && cubesLot.received_at === "2026-11-20T15:04:00.000Z";
})());
check("alibaba lot: source is the order marker", cubesLot?.source === "Alibaba order AO-MVA1QI1I-1");
check("alibaba lot: fifo addLot accepts it and lotCost ~= order total", (() => {
  if (!cubesLot) return false;
  const lots = addLot([], { id: "lot-1", ...cubesLot });
  return approx(lotCost(lots[0]), 1333.11, 0.02);
})());
check("alibaba lot: FIFO sell-through of the full lot costs ~= the order total", (() => {
  if (!cubesLot) return false;
  const lots = addLot([], { id: "lot-1", ...cubesLot });
  const sold = sellUnits(lots, "B081NZ4YMH", 350);
  return approx(sold.cogs, 1333.11, 0.02) && sold.remainingLots[0].units_remaining === 0;
})());
check("alibaba lot: null without a target ASIN or with unusable numbers",
  buildAlibabaOrderLot({ ...cubesOrder, targetAsin: null }) === null
  && buildAlibabaOrderLot({ ...cubesOrder, targetAsin: "  " }) === null
  && buildAlibabaOrderLot({ ...cubesOrder, qty: 0 }) === null
  && buildAlibabaOrderLot({ ...cubesOrder, orderTotal: -1 }) === null);

// 4. Purchase lot payload: unit price as-is, retailer host in source.
const intent = { id: "pi_mv77wc7z_1", asin: "B0DT4W7FP3", qty: 10, unitPrice: 10, retailerUrl: "https://www.walmart.com/ip/123" };
const purchaseLot = buildPurchaseIntentLot(intent, "2026-10-15T19:00:00.000Z");
check("purchase lot: payload at the intent's unit price", (() => {
  if (!purchaseLot) return false;
  return purchaseLot.asin === "B0DT4W7FP3" && purchaseLot.qty === 10
    && purchaseLot.units_remaining === 10 && purchaseLot.unit_cost === 10
    && purchaseLot.warehouse === null
    && purchaseLot.received_at === "2026-10-15T19:00:00.000Z";
})());
check("purchase lot: source carries retailer host + intent id",
  purchaseLot?.source === "walmart.com · intent pi_mv77wc7z_1");
check("purchase lot: source falls back honestly without a usable URL",
  purchaseLotSource("pi_x", null) === "Retail · intent pi_x"
  && purchaseLotSource("pi_x", "not a url") === "Retail · intent pi_x");
check("purchase lot: null on unusable input",
  buildPurchaseIntentLot({ ...intent, asin: " " }, "t") === null
  && buildPurchaseIntentLot({ ...intent, qty: 0 }, "t") === null
  && buildPurchaseIntentLot({ ...intent, qty: 1.5 }, "t") === null
  && buildPurchaseIntentLot({ ...intent, unitPrice: -1 }, "t") === null);

// 5. Idempotency keys: stable per origin id, distinct across origins.
check("idempotency: same order rebuilt yields the identical source marker",
  buildAlibabaOrderLot(cubesOrder)?.source === cubesLot?.source
  && alibabaLotSource("AO-MVA1QI1I-1") === "Alibaba order AO-MVA1QI1I-1");
check("idempotency: same intent rebuilt yields the identical source marker",
  buildPurchaseIntentLot(intent, "2026-10-16T00:00:00.000Z")?.source === purchaseLot?.source);
check("idempotency: different origins never share a marker",
  alibabaLotSource("AO-1") !== alibabaLotSource("AO-2")
  && purchaseLotSource("pi_1", null) !== purchaseLotSource("pi_2", null)
  && alibabaLotSource("AO-1") !== purchaseLotSource("AO-1", null));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
