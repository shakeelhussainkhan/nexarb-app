// Money module PR-B — server wiring for automatic inventory lots.
//
// Ensures a FIFO lot exists in `inventory_lots` for each executed buy:
//   - ensureAlibabaOrderLot: a DELIVERED alibaba_orders row (called from
//     the sync transition path and the reconcile-on-read backstop in
//     lib/alibaba/orders.ts).
//   - ensurePurchaseIntentLot: a purchase intent whose assisted
//     checkout reached `completed` (called from the checkout route).
//
// Both are BEST-EFFORT and never throw: they run inside read paths and
// status writes whose contract is "never fail the caller's request
// because of a side effect" (same discipline as the Alibaba sync's
// recordSyncAttempt). A failed ensure returns false and the caller
// carries on; the reconcile-on-read backstop retries on the next read.
//
// Idempotency is check-before-insert on the lot's `source` marker
// (built by lotsCore — it embeds the origin record's id, so it is
// unique per order/intent and stable across calls). A unique DB index
// would need the marker in its own column; migration 005 gave
// inventory_lots no such column, and the marker-in-source approach was
// preferred over a schema change. Residual risk, stated plainly: two
// ensures racing in the same instant could both pass the check and
// insert — the window is one round-trip and every production trigger
// is a sequential per-record path.

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildAlibabaOrderLot,
  buildPurchaseIntentLot,
  isDeliveredStatus,
  type InventoryLotPayload,
} from "./lotsCore";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Structural minimum of an alibaba_orders record (the full
 * AlibabaOrderRecord in lib/alibaba/orders.ts satisfies this; a local
 * shape keeps this module free of an import cycle). */
export interface AlibabaLotOrder {
  ref: string;
  status: string;
  targetAsin: string | null;
  qty: number;
  orderTotal: number;
  updatedAt: string | null;
}

/** Structural minimum of a purchase intent record
 * (PurchaseIntentRecord in lib/engine/guards.ts satisfies this). */
export interface PurchaseLotIntent {
  id: string;
  asin: string;
  qty: number;
  unitPrice: number;
  retailerUrl?: string | null;
}

async function insertLotIfAbsent(admin: Admin, payload: InventoryLotPayload): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id")
      .eq("source", payload.source)
      .limit(1);
    if (error) return false;
    if (data && data.length > 0) return false; // lot already exists — idempotent no-op
    const { error: insertError } = await admin.from("inventory_lots").insert(payload);
    return !insertError;
  } catch {
    return false;
  }
}

/** Ensure the FIFO lot for a delivered Alibaba order exists. Returns
 * true only when this call inserted the lot. Non-delivered orders are
 * gated out here as well as at the call sites (defense in depth — a
 * premature lot would let FIFO sell units that have not arrived). */
export async function ensureAlibabaOrderLot(admin: Admin, order: AlibabaLotOrder): Promise<boolean> {
  if (!isDeliveredStatus(order.status)) return false;
  const payload = buildAlibabaOrderLot(order);
  if (!payload) return false;
  return insertLotIfAbsent(admin, payload);
}

/** Ensure the FIFO lot for a completed retail purchase intent exists.
 * `receivedAtIso` is the checkout-completion time, supplied by the
 * caller. Returns true only when this call inserted the lot. */
export async function ensurePurchaseIntentLot(
  admin: Admin,
  intent: PurchaseLotIntent,
  receivedAtIso: string
): Promise<boolean> {
  const payload = buildPurchaseIntentLot(intent, receivedAtIso);
  if (!payload) return false;
  return insertLotIfAbsent(admin, payload);
}
