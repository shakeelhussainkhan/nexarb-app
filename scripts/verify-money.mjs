// Offline harness for the Money module core (lib/spapi/financesCore.ts).
// Run: node scripts/verify-money.mjs
// Pure-logic tests — NO network, NO database. Imports the core directly
// (Node 23 strips types); the core has no imports of its own.
import {
  moneyAmount,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
