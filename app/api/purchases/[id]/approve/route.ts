import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  buildAuditEntry,
  canTransition,
  sharedMemoryStore,
  supabaseIsConfigured,
  validNextStatuses,
  type PurchaseIntentRecord,
  type PurchaseStatus,
} from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";

// POST /api/purchases/[id]/approve
// Body: { decision: "approve" | "reject", reason?: string }
// Approving a human decision on a PENDING_APPROVAL intent; REJECTED is also
// reachable from APPROVED (buyer changed their mind before execution).
// Only the state machine in lib/engine/guards.ts decides which transitions
// are legal — anything else is a 422. Every decision writes an audit entry.
// Never executes a purchase by itself: EXECUTED is a separate, later step.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Purchase id required" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const decisionWord = String(body.decision ?? "").toLowerCase();
  const to: PurchaseStatus | null =
    decisionWord === "approve" ? "APPROVED" : decisionWord === "reject" ? "REJECTED" : null;
  if (!to) {
    return NextResponse.json(
      { error: "decision must be \"approve\" or \"reject\"" },
      { status: 400 }
    );
  }
  const reason = body.reason === undefined || body.reason === null ? null : String(body.reason);

  const useSupabase = supabaseIsConfigured(process.env);

  let current: PurchaseIntentRecord | undefined;
  try {
    current = useSupabase ? await getIntentSupabase(id) : sharedMemoryStore.getIntent(id);
  } catch (e) {
    return NextResponse.json(
      { error: "Could not load intent", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 503 }
    );
  }
  if (!current) {
    return NextResponse.json({ error: "Purchase intent not found" }, { status: 404 });
  }
  if (!canTransition(current.status, to)) {
    return NextResponse.json(
      {
        error: `Invalid transition ${current.status} -> ${to}`,
        reasons: [`Intent is ${current.status}; allowed next states: ${validNextStatuses(current.status).join(", ") || "none (terminal)"}.`],
      },
      { status: 422 }
    );
  }

  let updated: PurchaseIntentRecord | undefined;
  try {
    updated = useSupabase
      ? await transitionSupabase(id, to, userId, reason)
      : sharedMemoryStore.transition(id, to, userId, reason);
  } catch (e) {
    return NextResponse.json(
      { error: "Could not record decision", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 503 }
    );
  }
  if (!updated) {
    // The state changed between the read and the write.
    return NextResponse.json(
      { error: "Transition no longer valid", reasons: ["The intent's status changed before this decision was recorded — reload and try again."] },
      { status: 409 }
    );
  }

  const audit = buildAuditEntry(id, to === "APPROVED" ? "intent.approved" : "intent.rejected", userId, reason);
  try {
    if (useSupabase) {
      const sb = getSupabaseAdmin();
      const { error } = await sb.from("purchase_audit").insert({
        purchase_id: id,
        action: audit.action,
        actor: audit.actor,
        reason: audit.reason,
      });
      if (error) throw new Error(error.message);
    } else {
      sharedMemoryStore.appendAudit(audit);
    }
  } catch (e) {
    return NextResponse.json(
      { intent: updated, warning: `Audit entry failed: ${e instanceof Error ? e.message : "unknown error"}` }
    );
  }

  return NextResponse.json({ intent: updated });
}

async function getIntentSupabase(id: string): Promise<PurchaseIntentRecord | undefined> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("purchases").select("*").eq("id", id).single();
  if (error) {
    if (error.code === "PGRST116") return undefined; // no rows
    throw new Error(`Supabase intent read failed: ${error.message}`);
  }
  return rowToIntent(data as Record<string, unknown>);
}

async function transitionSupabase(
  id: string,
  to: PurchaseStatus,
  decidedBy: string,
  reason: string | null
): Promise<PurchaseIntentRecord | undefined> {
  const sb = getSupabaseAdmin();
  const current = await getIntentSupabase(id);
  if (!current || !canTransition(current.status, to)) return undefined;
  const { data, error } = await sb
    .from("purchases")
    .update({
      status: to,
      decided_at: new Date().toISOString(),
      decided_by: decidedBy,
      decision_reason: reason,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Supabase intent update failed: ${error.message}`);
  return rowToIntent(data as Record<string, unknown>);
}

function rowToIntent(row: Record<string, unknown>): PurchaseIntentRecord {
  return {
    id: String(row.id),
    asin: String(row.asin),
    qty: Number(row.qty),
    unitPrice: Number(row.unit_price),
    verdict: row.verdict as PurchaseIntentRecord["verdict"],
    eligibility: row.eligibility as PurchaseIntentRecord["eligibility"],
    status: row.status as PurchaseIntentRecord["status"],
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decisionReason: row.decision_reason ? String(row.decision_reason) : null,
  };
}
