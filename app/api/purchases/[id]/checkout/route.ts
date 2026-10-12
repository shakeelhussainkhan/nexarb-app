import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  buildAuditEntry,
  sharedMemoryStore,
  supabaseIsConfigured,
  type PurchaseIntentRecord,
} from "@/lib/engine/guards";
import {
  isCheckoutStatus,
  validateCheckoutRequest,
  validateCheckoutTransition,
  type CheckoutStatus,
} from "@/lib/engine/checkout";
import { getSupabaseAdmin } from "@/lib/supabase";

// POST /api/purchases/[id]/checkout
// Assisted-checkout queue for APPROVED purchase intents.
//
// Body: { action: "request" } — queue a browser-assisted checkout.
//         Requires the intent to be APPROVED and checkout_status to be
//         "none" or "failed". Sets checkout_status = "requested".
//       { action: "status", status: <CheckoutStatus> } — report progress.
//         Validates the transition (none→requested→in_progress→
//         awaiting_payment→completed, failed anywhere, retry from failed).
//
// The browser prepares the retail cart and STOPS at the payment step — it
// never enters card details and never completes payment. The founder
// confirms payment manually. This endpoint only moves the queue state;
// it never touches money. Never throws: every failure path returns JSON.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "Purchase id required" }, { status: 400 });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action !== "request" && action !== "status") {
      return NextResponse.json({ error: 'action must be "request" or "status"' }, { status: 400 });
    }

    const useSupabase = supabaseIsConfigured(process.env);
    const intent = useSupabase ? await getIntentSupabase(id) : sharedMemoryStore.getIntent(id);
    if (!intent) return NextResponse.json({ error: "Intent not found" }, { status: 404 });

    const currentCheckout: CheckoutStatus = isCheckoutStatus(intent.checkoutStatus)
      ? intent.checkoutStatus
      : "none";

    let next: CheckoutStatus;
    if (action === "request") {
      const v = validateCheckoutRequest(intent.status, currentCheckout);
      if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 422 });
      next = "requested";
    } else {
      const to = String(body.status ?? "");
      const v = validateCheckoutTransition(currentCheckout, to);
      if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 422 });
      next = to as CheckoutStatus;
    }

    try {
      if (useSupabase) {
        await setCheckoutSupabase(id, next);
      } else {
        const updated = sharedMemoryStore.setCheckoutStatus(id, next);
        if (!updated) return NextResponse.json({ error: "Intent not found" }, { status: 404 });
      }
    } catch (e) {
      return NextResponse.json(
        { error: "Could not update checkout status", reasons: [e instanceof Error ? e.message : "unknown error"] },
        { status: 503 }
      );
    }

    // Audit trail.
    const audit = buildAuditEntry(
      id,
      action === "request" ? "checkout.requested" : `checkout.${next}`,
      userId,
      null
    );
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
    } catch {
      // Non-fatal: state moved, audit failed. Surface as a warning.
    }

    const updatedIntent = useSupabase ? await getIntentSupabase(id) : sharedMemoryStore.getIntent(id);
    const warning =
      action === "request" && !intent.retailerUrl
        ? "No retailer URL on this intent — the browser will search by ASIN."
        : null;
    return NextResponse.json({ success: true, intent: updatedIntent, warning });
  } catch (e) {
    return NextResponse.json(
      { error: "Checkout request failed", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 500 }
    );
  }
}

async function getIntentSupabase(id: string): Promise<PurchaseIntentRecord | undefined> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("purchases")
    .select(
      "id, asin, qty, unit_price, verdict, eligibility, status, created_by, created_at, decided_at, decided_by, decision_reason, retailer_url, checkout_status"
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return undefined;
  const row = data as Record<string, unknown>;
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
    retailerUrl: row.retailer_url ? String(row.retailer_url) : null,
    checkoutStatus: row.checkout_status ? String(row.checkout_status) : "none",
  };
}

async function setCheckoutSupabase(id: string, to: CheckoutStatus): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("purchases").update({ checkout_status: to }).eq("id", id);
  if (error) throw new Error(`Supabase checkout update failed: ${error.message}`);
}
