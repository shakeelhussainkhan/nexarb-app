// Money module — pure core.
//
// Event → row mapping for the Amazon sales / fees / disbursement
// ingestion (SP-API Orders v2026-01-01 + Finances v0). No network, no database,
// no env, no imports: the sync route (lib/spapi/finances.ts) and the
// offline harness (scripts/verify-money.mjs) exercise every rule here.
//
// MONEY CONTRACT — read from app/dashboard/pnl/page.tsx, which consumes
// sales_events: revenue = Σ qty × unit_price; total fees = Σ fees;
// profit = revenue − FIFO COGS − fees. So a sale row's `fees` is a
// POSITIVE cost in dollars, and sales_events CHECKs enforce qty > 0,
// unit_price >= 0, fees >= 0.
//
// SP-API reports fee components SIGNED from the seller's perspective:
// a charge (commission, FBA fee) is a NEGATIVE Money amount; a credit
// (refund commission reversal) is POSITIVE. Row fees are therefore
//   fees = −(Σ signed fee components for the order+ASIN),
// clamped at 0 to satisfy the table CHECK. A clamp is never silent:
// attributeFees reports every clamped key so the sync summary can
// surface it as a warning.
//
// A "sale" is recorded when Amazon has SHIPPED it (the buyer is charged
// at shipment). Canceled orders are never sales; Unshipped/Pending
// orders are not sales yet — a later sync picks them up once shipped.
// Item principal/tax charges are NOT fees and never enter `fees`: the
// item price already lands in unit_price via the Orders API.

// --- SP-API payload shapes (structural subsets of Orders v0 / Finances v0) ---

export interface SpMoney {
  CurrencyCode?: string;
  Amount?: string | number; // Orders v0 sends strings; Finances v0 sends numbers
}

export interface SpOrderLite {
  AmazonOrderId: string;
  PurchaseDate?: string;
  OrderStatus?: string;
}

export interface SpOrderItemLite {
  AmazonOrderId?: string; // stamped by the fetcher (items are fetched per order)
  OrderItemId?: string;
  ASIN?: string;
  SellerSKU?: string;
  QuantityOrdered?: number;
  QuantityShipped?: number;
  ItemPrice?: SpMoney; // line TOTAL for QuantityOrdered units (Orders v0 semantics)
}

export interface SpFeeComponent {
  FeeType?: string;
  FeeAmount?: SpMoney;
}

export interface SpShipmentItemLite {
  OrderItemId?: string;
  SellerSKU?: string;
  ItemFeeList?: SpFeeComponent[];
}

export interface SpShipmentEventLite {
  AmazonOrderId?: string;
  ShipmentItemList?: SpShipmentItemLite[];
}

export interface SpRefundItemLite {
  OrderItemId?: string;
  SellerSKU?: string;
  ItemFeeAdjustmentList?: SpFeeComponent[];
}

export interface SpRefundEventLite {
  AmazonOrderId?: string;
  ShipmentItemAdjustmentList?: SpRefundItemLite[];
}

export interface SpFinancialEventsLite {
  ShipmentEventList?: SpShipmentEventLite[];
  RefundEventList?: SpRefundEventLite[];
}

export interface SpEventGroupLite {
  FinancialEventGroupId?: string;
  ProcessingStatus?: string;
  FundTransferStatus?: string;
  FundTransferDate?: string;
  PostedAfter?: string;
  PostedBefore?: string;
  OriginalTotal?: SpMoney;
  ConvertedTotal?: SpMoney;
}

// --- Row shapes (what the server upserts) -------------------------------------

export interface SaleRowDraft {
  amazonOrderId: string;
  asin: string;
  qty: number; // shipped units
  unitPrice: number; // dollars per unit, 2dp
  fees: number; // POSITIVE dollars; filled by applyFeesToRows (0 until then)
  soldAt: string | null; // order purchase date, ISO
}

export interface PayoutRowDraft {
  id: string;
  amazonGroupId: string;
  amount: number;
  currency: string;
  status: string;
  postedAt: string | null;
  bankTail: string | null;
  raw: unknown;
}

export interface FeeLine {
  amazonOrderId: string;
  orderItemId: string | null;
  sellerSku: string | null;
  signedAmount: number; // as SP-API reports it: charges negative, credits positive
}

// --- Small helpers --------------------------------------------------------------

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse an SP-API Money amount (string in Orders v0, number in Finances v0). Null when absent/unparseable. */
export function moneyAmount(m: SpMoney | undefined | null): number | null {
  if (!m || m.Amount === undefined || m.Amount === null) return null;
  const n = typeof m.Amount === "number" ? m.Amount : Number.parseFloat(String(m.Amount));
  return Number.isFinite(n) ? n : null;
}

/** Idempotency key for a sale row — mirrors the (amazon_order_id, asin) unique index from migration 022. */
export function saleKey(amazonOrderId: string, asin: string): string {
  return `${amazonOrderId}|${asin}`;
}

// --- Sync window ------------------------------------------------------------------

export interface SyncWindow {
  fromIso: string;
  toIso: string;
  days: number; // effective span, days (ceil)
}

const DAY_MS = 86400000;
// SP-API rejects a createdBefore that is in the future / immediate
// present (Orders v2026-01-01 requires it to be at least two minutes
// before the request), so the window always ends a few minutes behind "now".
const RECENCY_BUFFER_MS = 3 * 60 * 1000;

export function resolveWindow(
  now: Date,
  opts: { days?: number; from?: string; to?: string } = {}
): SyncWindow {
  const fromMs = opts.from ? Date.parse(opts.from) : NaN;
  const toMs = opts.to ? Date.parse(opts.to) : NaN;
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs) {
    return {
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
      days: Math.max(1, Math.ceil((toMs - fromMs) / DAY_MS)),
    };
  }
  const days = Math.min(90, Math.max(1, Math.trunc(opts.days ?? 30) || 30));
  const to = now.getTime() - RECENCY_BUFFER_MS;
  const from = to - days * DAY_MS;
  return { fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString(), days };
}

// --- Orders → sale rows -------------------------------------------------------------

export interface BuildSaleRowsResult {
  rows: SaleRowDraft[];
  stats: {
    ordersSeen: number;
    ordersEligible: number;
    skippedCanceled: number;
    skippedStatus: number;
    itemsMissingAsin: number;
    itemsZeroQty: number;
    itemsMissingPrice: number;
  };
}

const SALE_ORDER_STATUSES = new Set(["Shipped", "PartiallyShipped"]);

export function buildSaleRows(orders: SpOrderLite[], items: SpOrderItemLite[]): BuildSaleRowsResult {
  const stats: BuildSaleRowsResult["stats"] = {
    ordersSeen: orders.length,
    ordersEligible: 0,
    skippedCanceled: 0,
    skippedStatus: 0,
    itemsMissingAsin: 0,
    itemsZeroQty: 0,
    itemsMissingPrice: 0,
  };
  const eligible = new Map<string, SpOrderLite>();
  for (const o of orders) {
    if (!o.AmazonOrderId) continue;
    if (o.OrderStatus === "Canceled") {
      stats.skippedCanceled++;
      continue;
    }
    if (!o.OrderStatus || !SALE_ORDER_STATUSES.has(o.OrderStatus)) {
      stats.skippedStatus++;
      continue;
    }
    eligible.set(o.AmazonOrderId, o);
  }
  stats.ordersEligible = eligible.size;

  // Aggregate per (order, ASIN): an order can carry the same ASIN on
  // several lines. unit_price derives from the summed line totals over
  // the summed ORDERED quantities; qty recorded is SHIPPED units.
  interface Agg {
    order: SpOrderLite;
    asin: string;
    qtyShipped: number;
    qtyOrdered: number;
    priceTotal: number;
  }
  const byKey = new Map<string, Agg>();
  for (const item of items) {
    const orderId = item.AmazonOrderId;
    if (!orderId) continue;
    const order = eligible.get(orderId);
    if (!order) continue; // item of a skipped order — not a sale
    if (!item.ASIN) {
      stats.itemsMissingAsin++;
      continue;
    }
    const qtyOrdered = item.QuantityOrdered ?? 0;
    const qtyShipped = item.QuantityShipped ?? qtyOrdered;
    if (!(qtyOrdered > 0) || !(qtyShipped > 0)) {
      stats.itemsZeroQty++;
      continue;
    }
    const lineTotal = moneyAmount(item.ItemPrice);
    if (lineTotal === null) {
      stats.itemsMissingPrice++;
      continue;
    }
    const key = saleKey(orderId, item.ASIN);
    const agg = byKey.get(key) ?? { order, asin: item.ASIN, qtyShipped: 0, qtyOrdered: 0, priceTotal: 0 };
    agg.qtyShipped += qtyShipped;
    agg.qtyOrdered += qtyOrdered;
    agg.priceTotal += lineTotal;
    byKey.set(key, agg);
  }

  const rows: SaleRowDraft[] = [...byKey.values()].map((a) => ({
    amazonOrderId: a.order.AmazonOrderId,
    asin: a.asin,
    qty: a.qtyShipped,
    unitPrice: a.qtyOrdered > 0 ? round2(a.priceTotal / a.qtyOrdered) : 0,
    fees: 0,
    soldAt: a.order.PurchaseDate ?? null,
  }));
  rows.sort((x, y) => saleKey(x.amazonOrderId, x.asin).localeCompare(saleKey(y.amazonOrderId, y.asin)));
  return { rows, stats };
}

// --- Finances → fee lines → per-row fees ------------------------------------------------

function sumFeeComponents(fees: SpFeeComponent[] | undefined): number | null {
  if (!fees || fees.length === 0) return null;
  let sum = 0;
  for (const f of fees) sum += moneyAmount(f.FeeAmount) ?? 0;
  return sum;
}

/**
 * Flatten shipment + refund financial events into per-item signed fee
 * lines. Only ItemFeeList / ItemFeeAdjustmentList amounts are fees —
 * principal and tax charges are deliberately never read here.
 */
export function extractFeeLines(events: SpFinancialEventsLite): FeeLine[] {
  const lines: FeeLine[] = [];
  for (const ev of events.ShipmentEventList ?? []) {
    if (!ev.AmazonOrderId) continue;
    for (const item of ev.ShipmentItemList ?? []) {
      const signed = sumFeeComponents(item.ItemFeeList);
      if (signed === null) continue;
      lines.push({
        amazonOrderId: ev.AmazonOrderId,
        orderItemId: item.OrderItemId ?? null,
        sellerSku: item.SellerSKU ?? null,
        signedAmount: signed,
      });
    }
  }
  for (const ev of events.RefundEventList ?? []) {
    if (!ev.AmazonOrderId) continue;
    for (const item of ev.ShipmentItemAdjustmentList ?? []) {
      const signed = sumFeeComponents(item.ItemFeeAdjustmentList);
      if (signed === null) continue;
      lines.push({
        amazonOrderId: ev.AmazonOrderId,
        orderItemId: item.OrderItemId ?? null,
        sellerSku: item.SellerSKU ?? null,
        signedAmount: signed,
      });
    }
  }
  return lines;
}

export interface AttributeFeesResult {
  /** saleKey -> POSITIVE fee dollars (clamped at 0). Only keys with a resolved ASIN appear. */
  feesByKey: Map<string, number>;
  /** saleKeys whose net signed fees were a credit (would be negative) and were clamped to 0. */
  clampedKeys: string[];
  /** Lines that could not be attributed to any sale row in this run. */
  unattributedLines: number;
  /** Signed sum of the unattributed lines (SP-API sign convention). */
  unattributedSignedAmount: number;
}

/**
 * Attribute fee lines to sale rows. Finances v0 items carry OrderItemId
 * and SellerSKU but no ASIN, so attribution joins through the maps the
 * fetcher built from the Orders API (OrderItemId → ASIN primary,
 * SellerSKU → ASIN fallback). Last resort: an order with exactly one
 * sale-row ASIN absorbs its lines. Anything else is counted as
 * unattributed — never guessed onto a random ASIN.
 */
export function attributeFees(
  rows: SaleRowDraft[],
  feeLines: FeeLine[],
  asinByOrderItemId: Record<string, string>,
  asinBySku: Record<string, string>
): AttributeFeesResult {
  const rowKeys = new Set(rows.map((r) => saleKey(r.amazonOrderId, r.asin)));
  const asinsByOrder = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = asinsByOrder.get(r.amazonOrderId) ?? new Set<string>();
    set.add(r.asin);
    asinsByOrder.set(r.amazonOrderId, set);
  }

  const signedByKey = new Map<string, number>();
  let unattributedLines = 0;
  let unattributedSignedAmount = 0;
  for (const line of feeLines) {
    let asin: string | undefined;
    if (line.orderItemId) asin = asinByOrderItemId[line.orderItemId];
    if (!asin && line.sellerSku) asin = asinBySku[line.sellerSku];
    if (!asin) {
      const orderAsins = asinsByOrder.get(line.amazonOrderId);
      if (orderAsins && orderAsins.size === 1) asin = [...orderAsins][0];
    }
    const key = asin ? saleKey(line.amazonOrderId, asin) : null;
    if (!key || !rowKeys.has(key)) {
      unattributedLines++;
      unattributedSignedAmount += line.signedAmount;
      continue;
    }
    signedByKey.set(key, (signedByKey.get(key) ?? 0) + line.signedAmount);
  }

  const feesByKey = new Map<string, number>();
  const clampedKeys: string[] = [];
  for (const [key, signed] of signedByKey) {
    const fees = round2(-signed);
    if (fees < 0) {
      clampedKeys.push(key);
      feesByKey.set(key, 0);
    } else {
      feesByKey.set(key, fees);
    }
  }
  return { feesByKey, clampedKeys, unattributedLines, unattributedSignedAmount: round2(unattributedSignedAmount) };
}

/** Return new row objects with `fees` filled from attributeFees output (0 when none). */
export function applyFeesToRows(rows: SaleRowDraft[], feesByKey: Map<string, number>): SaleRowDraft[] {
  return rows.map((r) => ({ ...r, fees: feesByKey.get(saleKey(r.amazonOrderId, r.asin)) ?? 0 }));
}

// --- Orders API v2026-01-01 → lite shapes -------------------------------------
//
// Orders v0 is deprecated (Amazon's schedule removes it 2027-03-27);
// the sync now reads Orders v2026-01-01 `searchOrders`, which
// consolidates getOrders + getOrderItems into one call: items ride on
// each order, gated by the `includedData` parameter. The translator
// below maps the new payload onto the SpOrderLite / SpOrderItemLite
// contract the rest of this core already speaks. Field mapping per
// Amazon's official Orders API Migration Guide:
//   orderId                        -> AmazonOrderId
//   createdTime                    -> PurchaseDate
//   fulfillment.fulfillmentStatus  -> OrderStatus (values re-cased:
//                                      SHIPPED -> Shipped, CANCELLED -> Canceled, ...)
//   orderItems[].orderItemId       -> OrderItemId
//   orderItems[].product.asin      -> ASIN
//   orderItems[].product.sellerSku -> SellerSKU
//   orderItems[].quantityOrdered   -> QuantityOrdered
//   orderItems[].fulfillment.quantityFulfilled -> QuantityShipped
//                                      (requires includedData=FULFILLMENT)
//   orderItems[].proceeds.breakdowns[type=ITEM].subtotal -> ItemPrice
//                                      (line total for QuantityOrdered units;
//                                       requires includedData=PROCEEDS)
// v2026-01-01 Money is { amount, currencyCode } (camelCase; `amount`
// is a string in Amazon's published model examples), unlike the v0 /
// Finances v0 { Amount, CurrencyCode } shape moneyAmount parses.

export interface SpMoney2026 {
  amount?: string | number;
  currencyCode?: string;
}

export interface SpProceedsBreakdown2026 {
  type?: string;
  subtotal?: SpMoney2026;
}

export interface SpOrderItem2026 {
  orderItemId?: string;
  quantityOrdered?: number;
  product?: { asin?: string; sellerSku?: string };
  fulfillment?: { quantityFulfilled?: number };
  proceeds?: { breakdowns?: SpProceedsBreakdown2026[] };
}

export interface SpOrder2026 {
  orderId?: string;
  createdTime?: string;
  fulfillment?: { fulfillmentStatus?: string };
  orderItems?: SpOrderItem2026[];
}

/** Parse an Orders v2026-01-01 Money ({ amount, currencyCode }). Null when absent/unparseable. */
export function moneyAmount2026(m: SpMoney2026 | undefined | null): number | null {
  if (!m || m.amount === undefined || m.amount === null) return null;
  const n = typeof m.amount === "number" ? m.amount : Number.parseFloat(String(m.amount));
  return Number.isFinite(n) ? n : null;
}

const FULFILLMENT_STATUS_TO_V0: Record<string, string> = {
  SHIPPED: "Shipped",
  PARTIALLY_SHIPPED: "PartiallyShipped",
  CANCELLED: "Canceled",
  PENDING: "Pending",
  PENDING_AVAILABILITY: "PendingAvailability",
  UNSHIPPED: "Unshipped",
  UNFULFILLABLE: "Unfulfillable",
  INVOICE_UNCONFIRMED: "InvoiceUnconfirmed",
};

/**
 * Translate v2026-01-01 orders into the lite contract. ItemPrice is
 * the ITEM proceeds breakdown subtotal — the v0 ItemPrice equivalent
 * (a line total for the ordered quantity). Multiple ITEM breakdowns
 * (not expected) are summed; an item with no ITEM breakdown keeps
 * ItemPrice undefined so buildSaleRows counts it as missing-price
 * rather than inventing $0. An order without an orderId is dropped.
 */
export function mapOrders2026(orders: SpOrder2026[]): { orders: SpOrderLite[]; items: SpOrderItemLite[] } {
  const liteOrders: SpOrderLite[] = [];
  const liteItems: SpOrderItemLite[] = [];
  for (const o of orders) {
    if (!o.orderId) continue;
    const rawStatus = o.fulfillment?.fulfillmentStatus;
    liteOrders.push({
      AmazonOrderId: o.orderId,
      PurchaseDate: o.createdTime,
      OrderStatus: rawStatus ? (FULFILLMENT_STATUS_TO_V0[rawStatus] ?? rawStatus) : undefined,
    });
    for (const it of o.orderItems ?? []) {
      let itemTotal: number | null = null;
      let itemCurrency: string | undefined;
      for (const b of it.proceeds?.breakdowns ?? []) {
        if (b.type !== "ITEM") continue;
        const amt = moneyAmount2026(b.subtotal);
        if (amt === null) continue;
        itemTotal = (itemTotal ?? 0) + amt;
        itemCurrency = b.subtotal?.currencyCode ?? itemCurrency;
      }
      liteItems.push({
        AmazonOrderId: o.orderId,
        OrderItemId: it.orderItemId,
        ASIN: it.product?.asin,
        SellerSKU: it.product?.sellerSku,
        QuantityOrdered: it.quantityOrdered,
        QuantityShipped: it.fulfillment?.quantityFulfilled,
        ItemPrice: itemTotal === null ? undefined : { Amount: itemTotal, CurrencyCode: itemCurrency },
      });
    }
  }
  return { orders: liteOrders, items: liteItems };
}

// --- Financial event groups → payout rows -------------------------------------------------

/**
 * Map Finances v0 financial event groups to payout rows. A group that
 * has been disbursed carries FundTransferStatus/FundTransferDate and a
 * ConvertedTotal (the amount actually transferred, in the disbursement
 * currency); OriginalTotal is the pre-conversion fallback.
 *
 * bankTail is ALWAYS null from this API: Finances v0 group payloads
 * carry no bank-account identifier. The tail lives only in settlement
 * reports — never invent one.
 */
export function buildPayoutRows(groups: SpEventGroupLite[]): { rows: PayoutRowDraft[]; skippedNoId: number; skippedNoAmount: number } {
  const byId = new Map<string, PayoutRowDraft>();
  let skippedNoId = 0;
  let skippedNoAmount = 0;
  for (const g of groups) {
    const groupId = g.FinancialEventGroupId;
    if (!groupId) {
      skippedNoId++;
      continue;
    }
    const converted = moneyAmount(g.ConvertedTotal);
    const original = moneyAmount(g.OriginalTotal);
    const amount = converted ?? original;
    if (amount === null) {
      skippedNoAmount++;
      continue;
    }
    const currency =
      (converted !== null ? g.ConvertedTotal?.CurrencyCode : g.OriginalTotal?.CurrencyCode) ?? "USD";
    byId.set(groupId, {
      id: groupId,
      amazonGroupId: groupId,
      amount: round2(amount),
      currency,
      status: g.FundTransferStatus ?? g.ProcessingStatus ?? "Unknown",
      postedAt: g.FundTransferDate ?? g.PostedBefore ?? g.PostedAfter ?? null,
      bankTail: null,
      raw: g,
    });
  }
  return { rows: [...byId.values()], skippedNoId, skippedNoAmount };
}
