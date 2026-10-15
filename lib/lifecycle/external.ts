// Order lifecycle — external orders, server module.
//
// Database access for external_orders (migration 023): orders placed
// OUTSIDE the app (distributor portals, email orders) that the unified
// journeys view (GET /api/orders/journeys) renders alongside
// alibaba_orders and purchases. Milestones are append-only journey
// evidence in the canonical vocabulary of lib/lifecycle/core.ts —
// writers (POST /api/orders/external today; the Petra email watch
// later) append, never rewrite history.

import { getSupabaseAdmin } from "@/lib/supabase";
import { isCanonicalStage, type StageEntry } from "./core";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface ExternalOrderRecord {
  id: string;
  userId: string;
  ref: string;
  supplier: string;
  title: string;
  asin: string | null;
  qty: number | null;
  amount: number | null;
  currency: string;
  status: string;
  milestones: StageEntry[];
  raw: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

function rowToExternal(row: Record<string, unknown>): ExternalOrderRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    ref: String(row.ref),
    supplier: String(row.supplier),
    title: String(row.title),
    asin: row.asin ? String(row.asin) : null,
    qty: row.qty != null ? Number(row.qty) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    currency: String(row.currency ?? "USD"),
    status: String(row.status ?? "placed"),
    milestones: Array.isArray(row.milestones) ? (row.milestones as StageEntry[]) : [],
    raw: (row.raw as Record<string, unknown> | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

let extSeq = 0;
/** External order id, e.g. eo-m8xyz123-1 (same style as purchase intent ids). */
export function newExternalOrderId(now: Date = new Date()): string {
  extSeq += 1;
  return `eo_${now.getTime().toString(36)}_${extSeq.toString(36)}`;
}

export async function listExternalOrders(
  admin: Admin,
  userId: string,
  limit = 100
): Promise<ExternalOrderRecord[]> {
  const { data, error } = await admin
    .from("external_orders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`external_orders list failed: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToExternal);
}

export async function getExternalOrder(
  admin: Admin,
  userId: string,
  id: string
): Promise<ExternalOrderRecord | null> {
  const { data, error } = await admin
    .from("external_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`external_orders get failed: ${error.message}`);
  return data ? rowToExternal(data as Record<string, unknown>) : null;
}

export interface NewExternalOrder {
  ref: string;
  supplier: string;
  title: string;
  asin?: string | null;
  qty?: number | null;
  amount?: number | null;
  currency?: string;
  status?: string;
  milestones?: StageEntry[];
  raw?: Record<string, unknown> | null;
}

/** Insert a new external order. Returns the stored record. */
export async function createExternalOrder(
  admin: Admin,
  userId: string,
  input: NewExternalOrder
): Promise<ExternalOrderRecord> {
  const row = {
    id: newExternalOrderId(),
    user_id: userId,
    ref: input.ref,
    supplier: input.supplier,
    title: input.title,
    asin: input.asin ?? null,
    qty: input.qty ?? null,
    amount: input.amount ?? null,
    currency: input.currency ?? "USD",
    status: input.status ?? "placed",
    milestones: input.milestones ?? [],
    raw: input.raw ?? null,
  };
  const { data, error } = await admin.from("external_orders").insert(row).select("*").single();
  if (error || !data) throw new Error(`external_orders insert failed: ${error?.message ?? "unknown"}`);
  return rowToExternal(data as Record<string, unknown>);
}

/**
 * Append one milestone (and optionally move the status mirror) — the
 * write path later automation uses as evidence arrives (order
 * confirmations, invoices, tracking). Read-modify-write on the
 * milestones array; the stage is validated against the canonical
 * vocabulary so a bad writer can never poison a journey.
 */
export async function appendExternalMilestone(
  admin: Admin,
  userId: string,
  id: string,
  milestone: StageEntry,
  status?: string
): Promise<ExternalOrderRecord | null> {
  if (!isCanonicalStage(milestone.stage)) {
    throw new Error(`Unknown lifecycle stage: ${String(milestone.stage)}`);
  }
  const existing = await getExternalOrder(admin, userId, id);
  if (!existing) return null;
  const patch: Record<string, unknown> = {
    milestones: [...existing.milestones, milestone],
    updated_at: new Date().toISOString(),
  };
  if (status) patch.status = status;
  const { data, error } = await admin
    .from("external_orders")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`external_orders update failed: ${error?.message ?? "unknown"}`);
  return rowToExternal(data as Record<string, unknown>);
}
