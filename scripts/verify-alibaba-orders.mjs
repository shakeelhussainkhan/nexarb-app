// Offline harness for the Alibaba order flow core (lib/alibaba/ordersCore.ts)
// plus its guardrail integration with lib/engine/guards.ts.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-alibaba-orders.mjs
// Pure-logic tests — NO network, NO database.
import {
  canTransitionOrder,
  validNextOrderStatuses,
  ordersLiveFromEnv,
  draftBlockReason,
  totalsFromLanded,
  evaluateDraftEconomics,
  evaluatePlacement,
  mapAlibabaOrderStatus,
} from "@/lib/alibaba/ordersCore.ts";
import { parseProductDescription, bestLandedCost } from "@/lib/alibaba/core.ts";
import { screenProduct } from "@/lib/compliance/core.ts";
import { canCreateIntent, capsFromEnv, DEFAULT_SPEND_CAPS } from "@/lib/engine/guards.ts";

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

// --- live flag: default OFF, only explicit truthy values enable --------------
check("flag: unset -> orders NOT live", ordersLiveFromEnv({}) === false);
check("flag: 'false' -> not live", ordersLiveFromEnv({ ALIBABA_ORDERS_LIVE: "false" }) === false);
check("flag: 'true' -> live", ordersLiveFromEnv({ ALIBABA_ORDERS_LIVE: "true" }) === true);
check("flag: '1' -> live", ordersLiveFromEnv({ ALIBABA_ORDERS_LIVE: "1" }) === true);

// --- screening gate: BLOCKED can never become an order -------------------------
const blocked = screenProduct({ title: "Kratom powder 500g bulk", supplierName: "HerbCo" });
check("screening: prohibited product is blocked", blocked.verdict === "blocked", blocked.verdict);
check("screening: blocked product yields a draft refusal", draftBlockReason(blocked) !== null);
const clear = screenProduct({ title: "Silicone spatula set of 6, heat resistant", supplierName: "KitchenGoods Ltd" });
check("screening: ordinary product is clear", clear.verdict === "clear", clear.verdict);
check("screening: clear product yields no refusal", draftBlockReason(clear) === null);
const review = screenProduct({ title: "Compatible case for Apple iPhone", supplierName: null });
check("screening: brand-watchlist product is review, not blocked", review.verdict === "review", review.verdict);
check("screening: review product may still be drafted (human decides)", draftBlockReason(review) === null);

// --- landed-cost reuse: order totals come from bestLandedCost, unchanged -------
const payload = {
  result: {
    result_data: {
      product_id: 1600123456789,
      title: "Silicone spatula set of 6",
      min_order_quantity: 50,
      skus: [
        {
          sku_id: "sku-1",
          ladder_price: [
            { min_order_quantity: 50, price: 2.4 },
            { min_order_quantity: 100, price: 2.1 },
          ],
          shipping_fee: 30,
          currency: "USD",
        },
      ],
    },
  },
};
const detail = parseProductDescription(payload);
check("fixture: description parses", detail !== null);
const landed = detail ? bestLandedCost(detail, 100) : null;
check("fixture: landed cost computed at qty 100 (tier 2.10 + 30/100 ship)", landed !== null && landed.unitPrice === 2.1 && landed.shippingPerUnit === 0.3 && landed.landedPerUnit === 2.4, JSON.stringify(landed));
const totals = landed ? totalsFromLanded(landed) : { qty: -1, orderTotal: -1, landedPerUnit: -1 };
check(
  "totals: order total = qty x landed (same math as sourcing)",
  totals.qty === 100 && totals.orderTotal === 240 && totals.landedPerUnit === landed.landedPerUnit,
  JSON.stringify(totals)
);
const moqLanded = detail ? bestLandedCost(detail, 10) : null;
check("totals: qty below MOQ is raised to MOQ", moqLanded !== null && moqLanded.orderQty === 50 && totalsFromLanded(moqLanded).qty === 50);

// --- state machine: no path skips approval --------------------------------------
check("sm: draft -> pending_approval allowed", canTransitionOrder("draft", "pending_approval") === true);
check("sm: draft -> placed FORBIDDEN", canTransitionOrder("draft", "placed") === false);
check("sm: pending_approval -> placed FORBIDDEN", canTransitionOrder("pending_approval", "placed") === false);
check("sm: pending_approval -> approved allowed", canTransitionOrder("pending_approval", "approved") === true);
check("sm: approved -> placed allowed", canTransitionOrder("approved", "placed") === true);
check("sm: approved -> ready_to_place allowed", canTransitionOrder("approved", "ready_to_place") === true);
check("sm: ready_to_place -> placed allowed", canTransitionOrder("ready_to_place", "placed") === true);
check("sm: delivered is terminal", validNextOrderStatuses("delivered").length === 0);
check("sm: cancelled is terminal", validNextOrderStatuses("cancelled").length === 0);
check("sm: pending_approval can fall back to draft", canTransitionOrder("pending_approval", "draft") === true);

// --- placement gate: intent must be APPROVED -------------------------------------
const noIntent = evaluatePlacement({ orderStatus: "approved", intentStatus: null, ordersLive: true });
check("place: no linked intent -> refused", noIntent.allowed === false && noIntent.reasons.length > 0);
const pendingIntent = evaluatePlacement({ orderStatus: "approved", intentStatus: "PENDING_APPROVAL", ordersLive: true });
check("place: intent still PENDING_APPROVAL -> refused", pendingIntent.allowed === false);
const rejectedIntent = evaluatePlacement({ orderStatus: "approved", intentStatus: "REJECTED", ordersLive: true });
check("place: intent REJECTED -> refused", rejectedIntent.allowed === false);
const draftOrderGate = evaluatePlacement({ orderStatus: "draft", intentStatus: "APPROVED", ordersLive: true });
check("place: draft order -> refused even with an approved intent", draftOrderGate.allowed === false);
const liveOk = evaluatePlacement({ orderStatus: "approved", intentStatus: "APPROVED", ordersLive: true });
check("place: approved + APPROVED + live -> placed", liveOk.allowed === true && liveOk.outcome === "placed");
const darkOk = evaluatePlacement({ orderStatus: "approved", intentStatus: "APPROVED", ordersLive: false });
check("place: approved + APPROVED + flag off -> ready_to_place (NOT placed)", darkOk.allowed === true && darkOk.outcome === "ready_to_place");
const retryOk = evaluatePlacement({ orderStatus: "ready_to_place", intentStatus: "APPROVED", ordersLive: true });
check("place: ready_to_place retry with live flag -> placed", retryOk.allowed === true && retryOk.outcome === "placed");

// --- caps are consumed from lib/engine/guards (single source), never hardcoded ---
const defaultCaps = capsFromEnv({});
check(
  "caps: defaults come from guards DEFAULT_SPEND_CAPS",
  defaultCaps.dailySpendCap === DEFAULT_SPEND_CAPS.dailySpendCap && defaultCaps.perOrderCap === DEFAULT_SPEND_CAPS.perOrderCap
);
const raisedCaps = capsFromEnv({
  NEXARB_DAILY_SPEND_CAP: "2500",
  NEXARB_PER_ORDER_CAP: "1000",
  NEXARB_MAX_UNITS_PER_ASIN: "20",
});
const baseGate = {
  verdict: "BUY",
  eligibility: "SELLABLE",
  asin: "B0TESTASIN",
  caps: raisedCaps,
  usage: { spentToday: 0, unitsForAsinToday: 0 },
  killSwitchOn: false,
  recheckDone: true,
};
check("caps: $900 order passes the raised $1,000 per-order cap", canCreateIntent({ ...baseGate, qty: 10, unitPrice: 90 }).allowed === true);
const overOrder = canCreateIntent({ ...baseGate, qty: 10, unitPrice: 110 });
check("caps: $1,100 order fails the raised $1,000 per-order cap", overOrder.allowed === false && overOrder.reasons.some((r) => r.includes("per-order cap")));
const overDaily = canCreateIntent({ ...baseGate, qty: 10, unitPrice: 60, usage: { spentToday: 2000, unitsForAsinToday: 0 } });
check("caps: $2,000 already spent + $600 fails the $2,500 daily cap", overDaily.allowed === false && overDaily.reasons.some((r) => r.includes("daily spend cap")));
const overUnits = canCreateIntent({ ...baseGate, qty: 15, unitPrice: 10, usage: { spentToday: 0, unitsForAsinToday: 10 } });
check("caps: 10 committed + 15 more fails the 20 units/ASIN cap", overUnits.allowed === false && overUnits.reasons.some((r) => r.includes("units/ASIN")));
const oldCapsBlock = canCreateIntent({
  ...baseGate,
  caps: { dailySpendCap: 500, perOrderCap: 250, maxUnitsPerAsin: 20 },
  qty: 10,
  unitPrice: 90,
});
check("caps: the same $900 order FAILS under a $250 per-order cap object (caps are data from the source, not hardcoded)", oldCapsBlock.allowed === false);

// --- import-intent economics verdict (draft's own numbers, no velocity leg) -----
const econBuy = evaluateDraftEconomics({ landedPerUnit: 2.73, expectedSellPrice: 19.99 });
check("econ: packing-cubes draft (landed 2.73, sell 19.99) is BUY", econBuy.verdict === "BUY", JSON.stringify(econBuy));
check("econ: floor sits between landed cost and sell price (fee stack + 20% margin)", econBuy.floorPrice > 2.73 && econBuy.floorPrice < 19.99, String(econBuy.floorPrice));
const econSkip = evaluateDraftEconomics({ landedPerUnit: 2.73, expectedSellPrice: 11.99 });
check("econ: sell 11.99 below the ~$12.06 floor is SKIP", econSkip.verdict === "SKIP", JSON.stringify(econSkip));
const econUnknown = evaluateDraftEconomics({ landedPerUnit: 2.73, expectedSellPrice: null });
check("econ: missing expected sell price is UNKNOWN, never BUY", econUnknown.verdict === "UNKNOWN");

// --- import intent through the guardrail gate: unit cap exempt, dollars bind -----
const importGate = { ...baseGate, verdict: econBuy.verdict, qty: 350, unitPrice: 2.73, exemptUnitsCap: true };
check("gate: 350-unit import intent passes with the unit-cap exemption", canCreateIntent(importGate).allowed === true);
const importGateNoExempt = canCreateIntent({ ...importGate, exemptUnitsCap: false });
check("gate: the same intent WITHOUT the exemption fails the 20 units/ASIN cap", importGateNoExempt.allowed === false && importGateNoExempt.reasons.some((r) => r.includes("units/ASIN")));
const importGateOverOrder = canCreateIntent({ ...importGate, qty: 400 }); // $1,092 total
check("gate: the exemption does not lift the $1,000 per-order cap", importGateOverOrder.allowed === false && importGateOverOrder.reasons.some((r) => r.includes("per-order cap")));

// --- raw status mapping ------------------------------------------------------------
check("map: 'shipped' -> shipped", mapAlibabaOrderStatus("shipped") === "shipped");
check("map: 'Trade Complete' -> delivered", mapAlibabaOrderStatus("Trade Complete") === "delivered");
check("map: unknown string -> null (status untouched)", mapAlibabaOrderStatus("awaiting_fulfillment_step_3") === null);
check("map: non-string -> null", mapAlibabaOrderStatus(42) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
