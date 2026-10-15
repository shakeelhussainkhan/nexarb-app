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
  totalsFromLandedWithFreight,
  evaluateDraftEconomics,
  evaluatePlacement,
  mapAlibabaOrderStatus,
  buildFreightRequest,
  pickFreightSolution,
  freightGuard,
  buildCreateRequest,
  parseCreateResponse,
  parsePayResult,
  IMPORT_SHIP_TO,
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

// --- draft totals with REAL freight: the live quote replaces nominal shipping ---
// Live case (2026-10-15): the cubes draft's nominal shipping was $0.03/unit
// ($10.50 total); the real /order/freight/calculate quote was $388.11. A
// draft must be built on the real number so the approval is a true total.
const cubesLanded = { skuId: "105532731428", orderQty: 350, unitPrice: 2.7, shippingPerUnit: 0.03, landedPerUnit: 2.73 };
const cubesTotals = totalsFromLandedWithFreight(cubesLanded, 388.11);
check(
  "freight totals: product $945.00 + real freight $388.11 -> order total $1333.11",
  cubesTotals.qty === 350 && cubesTotals.unitPrice === 2.7 && cubesTotals.orderTotal === 1333.11,
  JSON.stringify(cubesTotals)
);
check(
  "freight totals: per-unit landed is $3.81 on real freight, not $2.73 on nominal shipping",
  cubesTotals.landedPerUnit === 3.81,
  JSON.stringify(cubesTotals)
);
check(
  "freight totals: shipping per unit is the real freight spread ($1.11), not the nominal $0.03",
  cubesTotals.shippingPerUnit === 1.11,
  JSON.stringify(cubesTotals)
);
const fixtureFreight = landed ? totalsFromLandedWithFreight(landed, 88.25) : null;
check(
  "freight totals: fixture — product $210.00 + freight $88.25 -> $298.25, landed $2.98, ship/unit $0.88 (nominal $0.30 replaced)",
  fixtureFreight !== null && fixtureFreight.orderTotal === 298.25 && fixtureFreight.landedPerUnit === 2.98 && fixtureFreight.shippingPerUnit === 0.88,
  JSON.stringify(fixtureFreight)
);

// --- state machine: no path skips approval --------------------------------------
check("sm: draft -> pending_approval allowed", canTransitionOrder("draft", "pending_approval") === true);
check("sm: draft -> placed FORBIDDEN", canTransitionOrder("draft", "placed") === false);
check("sm: pending_approval -> placed FORBIDDEN", canTransitionOrder("pending_approval", "placed") === false);
check("sm: pending_approval -> approved allowed", canTransitionOrder("pending_approval", "approved") === true);
check("sm: approved -> placed allowed", canTransitionOrder("approved", "placed") === true);
check("sm: approved -> ready_to_place allowed", canTransitionOrder("approved", "ready_to_place") === true);
check("sm: ready_to_place -> placed allowed", canTransitionOrder("ready_to_place", "placed") === true);
check("sm: approved -> awaiting_payment allowed", canTransitionOrder("approved", "awaiting_payment") === true);
check("sm: ready_to_place -> awaiting_payment allowed", canTransitionOrder("ready_to_place", "awaiting_payment") === true);
check("sm: awaiting_payment -> placed allowed (paid)", canTransitionOrder("awaiting_payment", "placed") === true);
check("sm: draft -> awaiting_payment FORBIDDEN (no path skips approval)", canTransitionOrder("draft", "awaiting_payment") === false);
check("sm: pending_approval -> awaiting_payment FORBIDDEN", canTransitionOrder("pending_approval", "awaiting_payment") === false);
check("sm: delivered is terminal", validNextOrderStatuses("delivered").length === 0);
check("sm: cancelled is terminal", validNextOrderStatuses("cancelled").length === 0);
check("sm: pending_approval can fall back to draft", canTransitionOrder("pending_approval", "draft") === true);
check("sm: failed -> awaiting_payment allowed (pre-create retry, live)", canTransitionOrder("failed", "awaiting_payment") === true);
check("sm: failed -> ready_to_place allowed (pre-create retry, flag off)", canTransitionOrder("failed", "ready_to_place") === true);
check("sm: failed -> placed allowed (retry outcome)", canTransitionOrder("failed", "placed") === true);
check("sm: failed -> shipped FORBIDDEN (a retry still goes through placement)", canTransitionOrder("failed", "shipped") === false);
check("sm: failed -> draft still allowed (housekeeping)", canTransitionOrder("failed", "draft") === true);

// --- placement gate: intent must be APPROVED -------------------------------------
const noIntent = evaluatePlacement({ orderStatus: "approved", intentStatus: null, ordersLive: true, hasAlibabaOrder: false });
check("place: no linked intent -> refused", noIntent.allowed === false && noIntent.reasons.length > 0);
const pendingIntent = evaluatePlacement({ orderStatus: "approved", intentStatus: "PENDING_APPROVAL", ordersLive: true, hasAlibabaOrder: false });
check("place: intent still PENDING_APPROVAL -> refused", pendingIntent.allowed === false);
const rejectedIntent = evaluatePlacement({ orderStatus: "approved", intentStatus: "REJECTED", ordersLive: true, hasAlibabaOrder: false });
check("place: intent REJECTED -> refused", rejectedIntent.allowed === false);
const draftOrderGate = evaluatePlacement({ orderStatus: "draft", intentStatus: "APPROVED", ordersLive: true, hasAlibabaOrder: false });
check("place: draft order -> refused even with an approved intent", draftOrderGate.allowed === false);
const liveOk = evaluatePlacement({ orderStatus: "approved", intentStatus: "APPROVED", ordersLive: true, hasAlibabaOrder: false });
check("place: approved + APPROVED + live -> awaiting_payment (created on Alibaba, unpaid)", liveOk.allowed === true && liveOk.outcome === "awaiting_payment");
const darkOk = evaluatePlacement({ orderStatus: "approved", intentStatus: "APPROVED", ordersLive: false, hasAlibabaOrder: false });
check("place: approved + APPROVED + flag off -> ready_to_place (NOT placed)", darkOk.allowed === true && darkOk.outcome === "ready_to_place");
const retryOk = evaluatePlacement({ orderStatus: "ready_to_place", intentStatus: "APPROVED", ordersLive: true, hasAlibabaOrder: false });
check("place: ready_to_place retry with live flag -> awaiting_payment", retryOk.allowed === true && retryOk.outcome === "awaiting_payment");
const approvedWithId = evaluatePlacement({ orderStatus: "approved", intentStatus: "APPROVED", ordersLive: true, hasAlibabaOrder: true });
check("place: approved order — hasAlibabaOrder does not change the gate", approvedWithId.allowed === true && approvedWithId.outcome === "awaiting_payment");

// --- placement gate: retry after a PRE-CREATE failure ---------------------------
// A placement that failed before anything was created on Alibaba (e.g. the
// freight quote errored) records `failed` with alibaba_order_id null — that
// failure must be retryable. A failed order WITH an Alibaba id was created
// there and must stay locked, or a retry would duplicate it.
const failedPreCreateLive = evaluatePlacement({ orderStatus: "failed", intentStatus: "APPROVED", ordersLive: true, hasAlibabaOrder: false });
check("place: failed + no Alibaba order + live -> allowed, awaiting_payment", failedPreCreateLive.allowed === true && failedPreCreateLive.outcome === "awaiting_payment");
const failedPreCreateDark = evaluatePlacement({ orderStatus: "failed", intentStatus: "APPROVED", ordersLive: false, hasAlibabaOrder: false });
check("place: failed + no Alibaba order + flag off -> allowed, ready_to_place", failedPreCreateDark.allowed === true && failedPreCreateDark.outcome === "ready_to_place");
const failedCreated = evaluatePlacement({ orderStatus: "failed", intentStatus: "APPROVED", ordersLive: true, hasAlibabaOrder: true });
check(
  "place: failed WITH an Alibaba order id -> refused (created on Alibaba, cannot place again)",
  failedCreated.allowed === false && failedCreated.reasons.some((r) => r.includes("already has an Alibaba order id")),
  JSON.stringify(failedCreated.reasons)
);
const failedRetryPendingIntent = evaluatePlacement({ orderStatus: "failed", intentStatus: "PENDING_APPROVAL", ordersLive: true, hasAlibabaOrder: false });
check("place: failed pre-create retry still requires an APPROVED intent", failedRetryPendingIntent.allowed === false);

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

// --- freight request shape (/order/freight/calculate, console-verified) ------------
const freightReq = buildFreightRequest({ eCompanyId: "enc-company-9", productId: "1601191618851", skuId: "105532731428", qty: 350 });
check("freight req: carries e_company_id + US destination", freightReq.e_company_id === "enc-company-9" && freightReq.destination_country === "US");
check(
  "freight req: product id is numeric, sku + quantity on the line",
  freightReq.logistics_product_list.length === 1 &&
    freightReq.logistics_product_list[0].product_id === 1601191618851 &&
    freightReq.logistics_product_list[0].sku_id === "105532731428" &&
    freightReq.logistics_product_list[0].quantity === 350,
  JSON.stringify(freightReq)
);
const freightReqNoSku = buildFreightRequest({ eCompanyId: "c1", productId: "abc-123", skuId: null, qty: 5 });
check(
  "freight req: non-numeric id stays a string; missing sku is omitted, never null",
  freightReqNoSku.logistics_product_list[0].product_id === "abc-123" && !("sku_id" in freightReqNoSku.logistics_product_list[0])
);

// --- freight solution pick: cheapest usable wins ------------------------------------
const freightResp = {
  result: {
    value: [
      { vendor_code: "ALI-EXPRESS-AIR", fee: { amount: 210.5, currency: "USD" }, delivery_time: "7-10 days", vendor_name: "Air" },
      { vendor_code: "ALI-LOGISTICS-SEA", fee: { amount: "88.25", currency: "USD" }, delivery_time: "25-35 days", vendor_name: "Sea" },
      { vendor_code: "NO-FEE", delivery_time: "?" },
    ],
  },
};
const picked = pickFreightSolution(freightResp);
check(
  "freight pick: cheapest usable solution (string fee parsed, fee-less entry skipped)",
  picked !== null && picked.carrierCode === "ALI-LOGISTICS-SEA" && picked.freightFee === 88.25 && picked.currency === "USD" && picked.deliveryTime === "25-35 days" && picked.vendorName === "Sea",
  JSON.stringify(picked)
);
check("freight pick: empty list -> null", pickFreightSolution({ result: { value: [] } }) === null);
check("freight pick: garbage -> null", pickFreightSolution({ nope: true }) === null && pickFreightSolution(null) === null && pickFreightSolution("x") === null);
check(
  "freight pick: top-level value[] shape also parses",
  pickFreightSolution({ value: [{ vendor_code: "V1", fee: { amount: 3 } }] })?.carrierCode === "V1"
);

// --- freight guard: real freight may not silently reprice an approved order --------
const guardPass = freightGuard({ productTotal: 945.0, freightFee: 10.5, approvedTotal: 955.5, perOrderCap: 1000 });
check("guard: cubes numbers (945 + 10.50 = 955.50 = approved) pass", guardPass.allowed === true, JSON.stringify(guardPass));
const guardApprovalFail = freightGuard({ productTotal: 945.0, freightFee: 200, approvedTotal: 955.5, perOrderCap: 2000 });
check(
  "guard: freight pushing the total >10% over the approved total is refused, with numbers",
  guardApprovalFail.allowed === false && guardApprovalFail.reasons.some((r) => r.includes("$1145.00") && r.includes("10%")),
  JSON.stringify(guardApprovalFail)
);
const guardCapFail = freightGuard({ productTotal: 900, freightFee: 50, approvedTotal: 955.5, perOrderCap: 900 });
check(
  "guard: within +10% of approved but over the per-order cap is refused, with numbers",
  guardCapFail.allowed === false && guardCapFail.reasons.some((r) => r.includes("per-order cap") && r.includes("$900.00")),
  JSON.stringify(guardCapFail)
);

// --- create request shape (/buynow/order/create, console-verified) ------------------
const createReq = buildCreateRequest({ ref: "AO-MV9VXZL3-1", carrierCode: "ALI-LOGISTICS-SEA", productId: "1601191618851", skuId: "105532731428", qty: 350 });
check("create req: channel_refer_id is OUR order ref", createReq.channel_refer_id === "AO-MV9VXZL3-1");
check(
  "create req: carrier from freight + CN dispatch",
  createReq.logistics_detail.carrier_code === "ALI-LOGISTICS-SEA" && createReq.logistics_detail.dispatch_location === "CN"
);
check(
  "create req: ship-to is the Automated 3PL warehouse, East Hartford CT",
  createReq.logistics_detail.shipment_address.address === "120 Tolland Street, Unit D" &&
    createReq.logistics_detail.shipment_address.city === "East Hartford" &&
    createReq.logistics_detail.shipment_address.contact_person === "Radu Daha" &&
    createReq.logistics_detail.shipment_address.country === "United States" &&
    createReq.logistics_detail.shipment_address.country_code === "US" &&
    createReq.logistics_detail.shipment_address.zip === "06108" &&
    IMPORT_SHIP_TO.zip === "06108",
  JSON.stringify(createReq.logistics_detail.shipment_address)
);
check(
  "create req: product line is numeric id + quantity + sku",
  createReq.product_list.length === 1 &&
    createReq.product_list[0].product_id === 1601191618851 &&
    createReq.product_list[0].quantity === 350 &&
    createReq.product_list[0].sku_id === "105532731428",
  JSON.stringify(createReq.product_list)
);

// --- create response parse: value.trade_id + value.pay_url ---------------------------
const createdParsed = parseCreateResponse({ result: { value: { trade_id: 800123456789, pay_url: "https://cashier.alibaba.com/pay/xyz" } } });
check(
  "create parse: numeric trade_id stringified, pay_url captured (result.value nesting)",
  createdParsed.tradeId === "800123456789" && createdParsed.payUrl === "https://cashier.alibaba.com/pay/xyz",
  JSON.stringify(createdParsed)
);
const createdFlat = parseCreateResponse({ value: { trade_id: "T-9", pay_url: "https://pay.example/9" } });
check("create parse: top-level value nesting also parses", createdFlat.tradeId === "T-9" && createdFlat.payUrl === "https://pay.example/9");
const createdNoTrade = parseCreateResponse({ result: { value: { pay_url: "https://pay.example/x" } } });
check("create parse: missing trade_id -> null tradeId (caller treats as NOT created)", createdNoTrade.tradeId === null);
check("create parse: garbage -> both null", (() => { const p = parseCreateResponse({}); return p.tradeId === null && p.payUrl === null; })());

// --- pay result parse (/alibaba/order/pay/result/query) -------------------------------
const paySuccess = parsePayResult({ result: { value: { status: "PAY_SUCCESS", pay_url: "https://cashier.alibaba.com/pay/xyz" } } });
check("pay parse: PAY_SUCCESS -> paid, pay_url captured", paySuccess.paid === true && paySuccess.status === "PAY_SUCCESS" && paySuccess.payUrl === "https://cashier.alibaba.com/pay/xyz");
const payUnpaid = parsePayResult({ value: { status: "UNPAY", reason_code: "NEVER_PAY_SUCCESS_IN_DROPSHIPER" } });
check("pay parse: UNPAY -> not paid", payUnpaid.paid === false && payUnpaid.status === "UNPAY");
const payFailed = parsePayResult({ value: { status: "PAY_FAILED" } });
check("pay parse: PAY_FAILED -> not paid", payFailed.paid === false && payFailed.status === "PAY_FAILED");
check("pay parse: garbage -> status null, not paid", (() => { const p = parsePayResult(null); return p.status === null && p.paid === false; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
