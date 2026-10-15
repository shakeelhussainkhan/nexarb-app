// Money module PR-B — pure lot math for automatic inventory lots.
//
// /dashboard/pnl FIFO-costs sales from `inventory_lots` (migration 005),
// but until now lots were only ever created by hand. This module builds
// the lot payloads for the two automatic sources:
//   - a DELIVERED Alibaba import order (lib/alibaba/orders.ts), and
//   - a retail purchase intent whose assisted checkout COMPLETED
//     (app/api/purchases/[id]/checkout).
//
// Pure functions only — no I/O, no imports — so scripts/verify-lots.mjs
// can exercise everything offline (same pattern as
// lib/spapi/financesCore.ts). The server wiring (existence check +
// insert) lives in lib/inventory/lots.ts.
//
// IDEMPOTENCY: inventory_lots has no dedicated marker column (migration
// 005: id, asin, qty, units_remaining, unit_cost, source, warehouse,
// received_at, created_at). The nullable free-text `source` column is
// the marker home: every auto lot's source embeds the id of the record
// it came from ("Alibaba order AO-…" / "<retailer> · intent pi_…"), so
// the server side can check-before-insert on an exact source match and
// the Inventory page still shows a truthful, human-readable source.
// One lot per origin id follows from the marker being a pure function
// of that id (see the stability tests in verify-lots.mjs).

/** Row shape inserted into inventory_lots — mirrors the fifo.ts
 * InventoryLot contract (minus id/created_at, which the DB assigns):
 * units_remaining starts at qty, and received_at drives FIFO order. */
export interface InventoryLotPayload {
  asin: string;
  qty: number;
  units_remaining: number;
  unit_cost: number;
  source: string;
  warehouse: string | null;
  received_at: string | null;
}

/** Round a unit cost to 4 decimal places — sub-cent precision so that
 * unit_cost × qty reproduces the order total to the cent (FIFO sums
 * per-unit costs; 2dp rounding would drift totals on bulk orders). */
export function roundUnitCost(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Landed unit cost = order total ÷ quantity. The Alibaba order total
 * already includes freight, and wave-1 orders ship Alibaba Logistics
 * DDP, so duty is inside the total too — total ÷ qty IS the landed
 * unit cost for those orders. Returns null when the division is not
 * meaningful (non-positive or non-integer qty, negative/non-finite
 * total) so callers skip lot creation instead of writing a bad lot. */
export function landedUnitCost(orderTotal: number, qty: number): number | null {
  if (!Number.isInteger(qty) || qty <= 0) return null;
  if (typeof orderTotal !== "number" || !Number.isFinite(orderTotal) || orderTotal < 0) return null;
  return roundUnitCost(orderTotal / qty);
}

/** The delivered-only gate for Alibaba lots: placed/shipped orders are
 * still in transit and must NOT become FIFO lots (their units cannot
 * be sold yet, and a premature lot would understate COGS age). */
export function isDeliveredStatus(status: string): boolean {
  return status === "delivered";
}

/** Idempotency marker + display source for an Alibaba import lot. */
export function alibabaLotSource(orderRef: string): string {
  return `Alibaba order ${orderRef}`;
}

/** Idempotency marker + display source for a retail purchase lot: the
 * retailer host when the intent carries a retailer URL (the purchases
 * table has no retailer-name column), else a plain "Retail" label. */
export function purchaseLotSource(intentId: string, retailerUrl: string | null | undefined): string {
  let host: string | null = null;
  if (retailerUrl) {
    try {
      host = new URL(retailerUrl).hostname.replace(/^www\./, "") || null;
    } catch {
      host = null;
    }
  }
  return `${host ?? "Retail"} · intent ${intentId}`;
}

export interface AlibabaLotInput {
  ref: string;
  targetAsin: string | null;
  qty: number;
  orderTotal: number;
  /** The order's updated_at — set when the status last moved, so for a
   * delivered order it is the best available delivery timestamp. */
  updatedAt: string | null;
}

/** Lot payload for a delivered Alibaba order, or null when the order
 * cannot produce a valid lot: no target ASIN (a lot is keyed by ASIN —
 * drafts that never got an ASIN cannot be costed), or unusable
 * qty/total. Units live at the 3PL: every Alibaba order's ship-to is
 * baked in as Automated 3PL at creation. */
export function buildAlibabaOrderLot(input: AlibabaLotInput): InventoryLotPayload | null {
  const asin = typeof input.targetAsin === "string" ? input.targetAsin.trim() : "";
  if (!asin) return null;
  const unitCost = landedUnitCost(input.orderTotal, input.qty);
  if (unitCost === null) return null;
  return {
    asin,
    qty: input.qty,
    units_remaining: input.qty,
    unit_cost: unitCost,
    source: alibabaLotSource(input.ref),
    warehouse: "Automated 3PL",
    received_at: input.updatedAt ? String(input.updatedAt) : null,
  };
}

export interface PurchaseLotInput {
  id: string;
  asin: string;
  qty: number;
  /** The intent's approved per-unit buy price. Unlike an Alibaba order
   * total this is NOT landed: 3PL prep/inbound for retail buys is not
   * tracked anywhere yet, so the lot carries the purchase price as-is
   * (the same basis the manual lots were logged on). */
  unitPrice: number;
  retailerUrl?: string | null;
}

/** Lot payload for a completed retail purchase intent, or null on
 * unusable input (blank ASIN, non-positive/non-integer qty, negative
 * or non-finite unit price). `receivedAtIso` is supplied by the caller
 * (the checkout-completion time) to keep this module clock-free. */
export function buildPurchaseIntentLot(
  input: PurchaseLotInput,
  receivedAtIso: string
): InventoryLotPayload | null {
  const asin = typeof input.asin === "string" ? input.asin.trim() : "";
  if (!asin) return null;
  if (!Number.isInteger(input.qty) || input.qty <= 0) return null;
  if (typeof input.unitPrice !== "number" || !Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return null;
  }
  return {
    asin,
    qty: input.qty,
    units_remaining: input.qty,
    unit_cost: roundUnitCost(input.unitPrice),
    source: purchaseLotSource(input.id, input.retailerUrl),
    warehouse: null,
    received_at: receivedAtIso,
  };
}
