// Offline harness for the Money module core (lib/spapi/financesCore.ts).
// Run: node scripts/verify-money.mjs
// Pure-logic tests — NO network, NO database. Imports the core directly
// (Node 23 strips types); the core has no imports of its own.
import {
  moneyAmount,
  moneyAmount2026,
  mapOrders2026,
  round2,
  resolveWindow,
  saleKey,
  buildSaleRows,
  extractFeeLines,
  attributeFees,
  applyFeesToRows,
  buildPayoutRows,
} from "../lib/spapi/financesCore.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const approx = (a, b) => Math.abs(a - b) < 0.005;

// 1. Money parsing: Orders v0 sends strings, Finances v0 sends numbers.
check("moneyAmount parses string amounts", moneyAmount({ Amount: "19.99" }) === 19.99);
check("moneyAmount parses numeric amounts", moneyAmount({ Amount: 4.5 }) === 4.5);
check("moneyAmount null when absent or unparseable",
  moneyAmount(undefined) === null && moneyAmount({}) === null && moneyAmount({ Amount: "abc" }) === null);
check("round2 rounds to cents", round2(1.005) === 1 || round2(2.675) === 2.68); // float-safe either way

// 2. Window math: default 30d ending behind a recency buffer; days clamped; explicit bounds win.
check("resolveWindow default is 30d ending ~3min behind now", (() => {
  const now = new Date("2026-10-15T12:00:00Z");
  const w = resolveWindow(now);
  const to = Date.parse(w.toIso), from = Date.parse(w.fromIso);
  return w.days === 30 && to <= now.getTime() - 2 * 60000 && to >= now.getTime() - 4 * 60000 && to - from === 30 * 86400000;
})());
check("resolveWindow clamps days to 1..90",
  resolveWindow(new Date(), { days: 500 }).days === 90 && resolveWindow(new Date(), { days: -5 }).days === 1);
check("resolveWindow honours explicit from/to", (() => {
  const w = resolveWindow(new Date(), { from: "2026-09-01T00:00:00Z", to: "2026-09-11T00:00:00Z" });
  return w.fromIso === "2026-09-01T00:00:00.000Z" && w.toIso === "2026-09-11T00:00:00.000Z" && w.days === 10;
})());

// 3. Orders -> sale rows.
const orders = [
  { AmazonOrderId: "O1", PurchaseDate: "2026-10-01T10:00:00Z", OrderStatus: "Shipped" },
  { AmazonOrderId: "O2", PurchaseDate: "2026-10-02T10:00:00Z", OrderStatus: "Canceled" },
  { AmazonOrderId: "O3", PurchaseDate: "2026-10-03T10:00:00Z", OrderStatus: "Unshipped" },
  { AmazonOrderId: "O4", PurchaseDate: "2026-10-04T10:00:00Z", OrderStatus: "PartiallyShipped" },
];
const items = [
  { AmazonOrderId: "O1", OrderItemId: "it-a1", ASIN: "B0AAAAAAA1", QuantityOrdered: 2, QuantityShipped: 2, ItemPrice: { Amount: "39.98" } },
  { AmazonOrderId: "O1", OrderItemId: "it-a2", ASIN: "B0AAAAAAA1", QuantityOrdered: 1, QuantityShipped: 1, ItemPrice: { Amount: "19.99" } },
  { AmazonOrderId: "O1", OrderItemId: "it-b1", ASIN: "B0BBBBBBB2", SellerSKU: "SKU-B", QuantityOrdered: 1, QuantityShipped: 1, ItemPrice: { Amount: "10.00" } },
  { AmazonOrderId: "O2", OrderItemId: "it-c1", ASIN: "B0CCCCCCC3", QuantityOrdered: 1, QuantityShipped: 0, ItemPrice: { Amount: "5.00" } },
  { AmazonOrderId: "O3", OrderItemId: "it-u1", ASIN: "B0UUUUUUU8", QuantityOrdered: 1, QuantityShipped: 0, ItemPrice: { Amount: "7.00" } },
  { AmazonOrderId: "O4", OrderItemId: "it-d1", ASIN: "B0DDDDDDD4", QuantityOrdered: 3, QuantityShipped: 1, ItemPrice: { Amount: "30.00" } },
  { AmazonOrderId: "O1", OrderItemId: "it-x1", QuantityOrdered: 1, QuantityShipped: 1, ItemPrice: { Amount: "1.00" } }, // no ASIN
  { AmazonOrderId: "O1", OrderItemId: "it-x2", ASIN: "B0EEEEEEE5", QuantityOrdered: 2, QuantityShipped: 0, ItemPrice: { Amount: "8.00" } }, // zero shipped
  { AmazonOrderId: "O1", OrderItemId: "it-x3", ASIN: "B0FFFFFFF6", QuantityOrdered: 1, QuantityShipped: 1 }, // no price
];
const built = buildSaleRows(orders, items);
const rowByKey = new Map(built.rows.map((r) => [saleKey(r.amazonOrderId, r.asin), r]));

check("sale rows: only shipped/partially-shipped orders produce rows", built.rows.length === 3, `got ${built.rows.length}`);
check("sale rows: same-ASIN lines aggregate with unit price from line totals", (() => {
  const r = rowByKey.get("O1|B0AAAAAAA1");
  return r && r.qty === 3 && approx(r.unitPrice, 19.99) && r.soldAt === "2026-10-01T10:00:00Z" && r.fees === 0;
})());
check("sale rows: partial shipment records shipped qty at full unit price", (() => {
  const r = rowByKey.get("O4|B0DDDDDDD4");
  return r && r.qty === 1 && approx(r.unitPrice, 10.0);
})());
check("sale rows: skip stats are honest",
  built.stats.skippedCanceled === 1 && built.stats.skippedStatus === 1
  && built.stats.itemsMissingAsin === 1 && built.stats.itemsZeroQty === 1 && built.stats.itemsMissingPrice === 1,
  JSON.stringify(built.stats));
check("sale rows: deterministic re-run (upsert idempotency at the payload level)",
  JSON.stringify(buildSaleRows(orders, items).rows) === JSON.stringify(built.rows));

// 4. Fee lines: fee components only, SP-API sign preserved.
const events = {
  ShipmentEventList: [
    {
      AmazonOrderId: "O1",
      ShipmentItemList: [
        { OrderItemId: "it-a1", SellerSKU: "SKU-A", ItemFeeList: [
          { FeeType: "Commission", FeeAmount: { Amount: -3.0 } },
          { FeeType: "FBAPerUnitFulfillmentFee", FeeAmount: { Amount: -4.5 } },
        ]},
        { OrderItemId: "it-b1", SellerSKU: "SKU-B" }, // no fee list -> no line
      ],
    },
    { ShipmentItemList: [{ OrderItemId: "zz", ItemFeeList: [{ FeeType: "Commission", FeeAmount: { Amount: -1 } }] }] }, // no order id -> dropped
  ],
  RefundEventList: [
    {
      AmazonOrderId: "O1",
      ShipmentItemAdjustmentList: [
        { OrderItemId: "it-a1", ItemFeeAdjustmentList: [
          { FeeType: "Commission", FeeAmount: { Amount: 2.55 } },
          { FeeType: "RefundAdministrationFee", FeeAmount: { Amount: -0.45 } },
        ]},
      ],
    },
  ],
};
const feeLines = extractFeeLines(events);
check("fee lines: shipment item fees sum signed", (() => {
  const l = feeLines.find((x) => x.orderItemId === "it-a1" && x.signedAmount < 0);
  return l && approx(l.signedAmount, -7.5) && l.amazonOrderId === "O1";
})());
check("fee lines: refund adjustments keep their (net credit) sign", (() => {
  const l = feeLines.find((x) => x.orderItemId === "it-a1" && x.signedAmount > 0);
  return l && approx(l.signedAmount, 2.1);
})());
check("fee lines: items without fee lists and events without order ids produce no lines", feeLines.length === 2, `got ${feeLines.length}`);

// 5. Attribution: OrderItemId join, SKU fallback, single-ASIN fallback, unattributed, clamp.
const attr = attributeFees(
  built.rows,
  [
    ...feeLines,
    { amazonOrderId: "O1", orderItemId: null, sellerSku: "SKU-B", signedAmount: -1.25 },
    { amazonOrderId: "O4", orderItemId: null, sellerSku: null, signedAmount: -2.0 },
    { amazonOrderId: "O9", orderItemId: "nope", sellerSku: null, signedAmount: -9.99 },
    { amazonOrderId: "O1", orderItemId: "unknown-item", sellerSku: "UNKNOWN-SKU", signedAmount: -0.5 },
  ],
  { "it-a1": "B0AAAAAAA1" },
  { "SKU-B": "B0BBBBBBB2" }
);
check("attribution: OrderItemId join nets shipment + refund into POSITIVE fees", approx(attr.feesByKey.get("O1|B0AAAAAAA1") ?? -1, 5.4));
check("attribution: SKU fallback works", approx(attr.feesByKey.get("O1|B0BBBBBBB2") ?? -1, 1.25));
check("attribution: single-ASIN order absorbs id-less lines", approx(attr.feesByKey.get("O4|B0DDDDDDD4") ?? -1, 2.0));
check("attribution: unknown order and ambiguous multi-ASIN lines stay unattributed",
  attr.unattributedLines === 2 && approx(attr.unattributedSignedAmount, -10.49));

const clampAttr = attributeFees(
  [{ amazonOrderId: "O5", asin: "B0GGGGGGG7", qty: 1, unitPrice: 10, fees: 0, soldAt: null }],
  [{ amazonOrderId: "O5", orderItemId: "x", sellerSku: null, signedAmount: 3.0 }],
  { x: "B0GGGGGGG7" },
  {}
);
check("attribution: net fee credit clamps to $0 and is reported, never negative",
  clampAttr.feesByKey.get("O5|B0GGGGGGG7") === 0 && clampAttr.clampedKeys.includes("O5|B0GGGGGGG7"));

const withFees = applyFeesToRows(built.rows, attr.feesByKey);
check("applyFeesToRows fills fees and defaults others to 0", (() => {
  const a = withFees.find((r) => r.asin === "B0AAAAAAA1");
  const b = withFees.find((r) => r.asin === "B0DDDDDDD4");
  return a && approx(a.fees, 5.4) && b && approx(b.fees, 2.0) && built.rows.every((r) => r.fees === 0);
})());

// 6. Payouts: converted total preferred, honest status/posted fallbacks, bank tail always null.
const payouts = buildPayoutRows([
  { FinancialEventGroupId: "G1", ProcessingStatus: "Closed", FundTransferStatus: "Succeeded", FundTransferDate: "2026-10-05T00:00:00Z",
    OriginalTotal: { CurrencyCode: "USD", Amount: 123.45 }, ConvertedTotal: { CurrencyCode: "USD", Amount: 123.45 } },
  { FinancialEventGroupId: "G2", ProcessingStatus: "Closed", PostedBefore: "2026-10-06T00:00:00Z",
    OriginalTotal: { CurrencyCode: "EUR", Amount: "10.00" } },
  { ProcessingStatus: "Open", OriginalTotal: { CurrencyCode: "USD", Amount: 1 } }, // no id
  { FinancialEventGroupId: "G4", ProcessingStatus: "Open" }, // no amount
  { FinancialEventGroupId: "G1", ProcessingStatus: "Closed", FundTransferStatus: "Succeeded", FundTransferDate: "2026-10-05T00:00:00Z",
    ConvertedTotal: { CurrencyCode: "USD", Amount: 200 } }, // duplicate id — last wins
]);
check("payouts: converted total + fund-transfer status/date win", (() => {
  const g1 = payouts.rows.find((r) => r.amazonGroupId === "G1");
  return g1 && approx(g1.amount, 200) && g1.currency === "USD" && g1.status === "Succeeded" && g1.postedAt === "2026-10-05T00:00:00Z";
})());
check("payouts: original total + processing status + PostedBefore fallbacks", (() => {
  const g2 = payouts.rows.find((r) => r.amazonGroupId === "G2");
  return g2 && approx(g2.amount, 10) && g2.currency === "EUR" && g2.status === "Closed" && g2.postedAt === "2026-10-06T00:00:00Z";
})());
check("payouts: bank tail is never invented (always null from Finances v0)",
  payouts.rows.every((r) => r.bankTail === null));
check("payouts: skips are counted and duplicates deduped",
  payouts.skippedNoId === 1 && payouts.skippedNoAmount === 1 && payouts.rows.length === 2);

// 7. Orders v2026-01-01 translation (mapOrders2026). Fixtures are
// excerpted from the searchOrders example response embedded in
// Amazon's OFFICIAL orders_2026-01-01 model
// (amzn/selling-partner-api-models, models/orders-api-model):
// order 123-4567890-1234567, Echo Dot x2 (ITEM subtotal 99.98) +
// Fire TV Stick x1 (ITEM subtotal 49.99), fulfillmentStatus SHIPPED.
check("moneyAmount2026 parses the new {amount, currencyCode} shape",
  moneyAmount2026({ amount: "19.99", currencyCode: "USD" }) === 19.99
  && moneyAmount2026({ amount: 4.5 }) === 4.5
  && moneyAmount2026(undefined) === null && moneyAmount2026({}) === null);

const orders2026 = [
  {
    orderId: "123-4567890-1234567",
    createdTime: "2024-12-25T10:30:00Z",
    fulfillment: { fulfillmentStatus: "SHIPPED", fulfilledBy: "MERCHANT" },
    orderItems: [
      {
        orderItemId: "12345678901234",
        quantityOrdered: 2,
        product: { asin: "B08N5WRWNW", sellerSku: "ECHO-DOT-4-CHARCOAL" },
        proceeds: { breakdowns: [
          { type: "ITEM", subtotal: { amount: "99.98", currencyCode: "USD" } },
          { type: "TAX", subtotal: { amount: "0.02", currencyCode: "USD" } },
        ] },
        fulfillment: { quantityFulfilled: 2, quantityUnfulfilled: 0 },
      },
      {
        orderItemId: "12345678901235",
        quantityOrdered: 1,
        product: { asin: "B07XJ8C8F5", sellerSku: "FIRE-TV-4K-2021" },
        proceeds: { breakdowns: [
          { type: "ITEM", subtotal: { amount: "49.99", currencyCode: "USD" } },
        ] },
        fulfillment: { quantityFulfilled: 1, quantityUnfulfilled: 0 },
      },
    ],
  },
];
const mapped = mapOrders2026(orders2026);
check("mapOrders2026: order id/date map and status re-cases to the lite vocabulary",
  mapped.orders.length === 1
  && mapped.orders[0].AmazonOrderId === "123-4567890-1234567"
  && mapped.orders[0].PurchaseDate === "2024-12-25T10:30:00Z"
  && mapped.orders[0].OrderStatus === "Shipped");
check("mapOrders2026: item fields map; ItemPrice is the ITEM breakdown only (TAX excluded)",
  mapped.items.length === 2
  && mapped.items[0].ASIN === "B08N5WRWNW" && mapped.items[0].SellerSKU === "ECHO-DOT-4-CHARCOAL"
  && mapped.items[0].QuantityOrdered === 2 && mapped.items[0].QuantityShipped === 2
  && approx(moneyAmount(mapped.items[0].ItemPrice) ?? -1, 99.98)
  && mapped.items[0].AmazonOrderId === "123-4567890-1234567");
check("mapOrders2026 -> buildSaleRows: official example yields both rows at $49.99/unit", (() => {
  const r = buildSaleRows(mapped.orders, mapped.items);
  const a = r.rows.find((x) => x.asin === "B08N5WRWNW");
  const b = r.rows.find((x) => x.asin === "B07XJ8C8F5");
  return r.rows.length === 2 && a && a.qty === 2 && approx(a.unitPrice, 49.99)
    && b && b.qty === 1 && approx(b.unitPrice, 49.99)
    && a.soldAt === "2024-12-25T10:30:00Z";
})());

const cancelled2026 = mapOrders2026([
  { orderId: "C1", createdTime: "2026-10-01T00:00:00Z", fulfillment: { fulfillmentStatus: "CANCELLED" },
    orderItems: [{ orderItemId: "ci1", quantityOrdered: 1, product: { asin: "B0CCCCCCC3" },
      proceeds: { breakdowns: [{ type: "ITEM", subtotal: { amount: "5.00", currencyCode: "USD" } }] },
      fulfillment: { quantityFulfilled: 0 } }] },
]);
check("mapOrders2026: CANCELLED re-cases to Canceled and buildSaleRows skips it",
  cancelled2026.orders[0].OrderStatus === "Canceled"
  && buildSaleRows(cancelled2026.orders, cancelled2026.items).stats.skippedCanceled === 1
  && buildSaleRows(cancelled2026.orders, cancelled2026.items).rows.length === 0);

const partial2026 = mapOrders2026([
  { orderId: "P1", createdTime: "2026-10-02T00:00:00Z", fulfillment: { fulfillmentStatus: "PARTIALLY_SHIPPED" },
    orderItems: [{ orderItemId: "pi1", quantityOrdered: 3, product: { asin: "B0DDDDDDD4" },
      proceeds: { breakdowns: [{ type: "ITEM", subtotal: { amount: "30.00", currencyCode: "USD" } }] },
      fulfillment: { quantityFulfilled: 1 } }] },
]);
check("mapOrders2026: PARTIALLY_SHIPPED keeps fulfilled qty at full unit price", (() => {
  const r = buildSaleRows(partial2026.orders, partial2026.items);
  return partial2026.orders[0].OrderStatus === "PartiallyShipped"
    && r.rows.length === 1 && r.rows[0].qty === 1 && approx(r.rows[0].unitPrice, 10.0);
})());

const noItemBreakdown2026 = mapOrders2026([
  { orderId: "N1", createdTime: "2026-10-03T00:00:00Z", fulfillment: { fulfillmentStatus: "SHIPPED" },
    orderItems: [{ orderItemId: "ni1", quantityOrdered: 1, product: { asin: "B0FFFFFFF6" },
      proceeds: { breakdowns: [{ type: "TAX", subtotal: { amount: "1.00", currencyCode: "USD" } }] },
      fulfillment: { quantityFulfilled: 1 } }] },
]);
check("mapOrders2026: no ITEM breakdown -> missing price (never an invented $0)",
  noItemBreakdown2026.items[0].ItemPrice === undefined
  && buildSaleRows(noItemBreakdown2026.orders, noItemBreakdown2026.items).stats.itemsMissingPrice === 1);

const noFulfillment2026 = mapOrders2026([
  { orderId: "F1", createdTime: "2026-10-04T00:00:00Z", fulfillment: { fulfillmentStatus: "SHIPPED" },
    orderItems: [{ orderItemId: "fi1", quantityOrdered: 2, product: { asin: "B0GGGGGGG7" },
      proceeds: { breakdowns: [{ type: "ITEM", subtotal: { amount: "20.00", currencyCode: "USD" } }] } }] },
]);
check("mapOrders2026: absent item fulfillment leaves QuantityShipped undefined; core falls back to ordered qty",
  noFulfillment2026.items[0].QuantityShipped === undefined
  && buildSaleRows(noFulfillment2026.orders, noFulfillment2026.items).rows[0]?.qty === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
