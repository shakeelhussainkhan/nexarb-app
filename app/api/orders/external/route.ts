import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { createExternalOrder } from "@/lib/lifecycle/external";

// POST /api/orders/external — Clerk session OR personal API key
// (X-NexArb-Key) via resolveUser, like the other automation-readable
// routes. PR-D1 shipped this session-only; the founder then directed
// (2026-10-15) that Muse register distributor portal orders on his
// behalf going forward — a cron-key write path is what makes that
// possible, and the Petra email watch appends milestones through the
// sibling route (POST /api/orders/external/[id]/milestones). The
// resolveUser decision rules are unchanged: a presented plausible key
// decides alone (an invalid/revoked key rejects — it never falls back
// to an ambient session), and no key means the session decides.
//
// An external order is one placed OUTSIDE the app — e.g. the Petra
// portal order the founder placed in his own browser. Body:
//   { ref, supplier, title,            — required, non-empty strings
//     asin?, qty?, amount?, currency? } — optional facts, stored as given
// The row is created truthfully at the stage the order is known to be
// at: a portal order exists and is awaiting fulfillment, so the journey
// starts with one milestone — { stage: "placed" } — whose `source`
// records HOW the row got here: "manual" for a session (the founder
// typed it into the Orders page) or "automation" for an API-key write
// (Muse registering a portal order from its confirmation email).
// Later evidence (confirmation/invoice/tracking emails, via
// appendExternalMilestone) extends the journey. No stage beyond
// `placed` is asserted here, and no demo/seed data is ever written.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = identity.userId;
    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { error: "Supabase is not configured in this environment, so external orders cannot be recorded." },
        { status: 503 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    const supplier = typeof body.supplier === "string" ? body.supplier.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const problems: string[] = [];
    if (!ref) problems.push("ref is required (e.g. the PO number or the supplier's order number).");
    if (!supplier) problems.push("supplier is required.");
    if (!title) problems.push("title is required.");

    let asin: string | null = null;
    if (body.asin !== undefined && body.asin !== null && body.asin !== "") {
      asin = String(body.asin).trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) problems.push("asin must be a valid 10-character ASIN when given.");
    }
    let qty: number | null = null;
    if (body.qty !== undefined && body.qty !== null) {
      qty = Number(body.qty);
      if (!Number.isInteger(qty) || qty <= 0) problems.push("qty must be a positive integer when given.");
    }
    let amount: number | null = null;
    if (body.amount !== undefined && body.amount !== null) {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) problems.push("amount must be a non-negative number when given.");
    }
    const currency =
      typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : "USD";

    if (problems.length > 0) {
      return NextResponse.json({ error: "Invalid external order", reasons: problems }, { status: 400 });
    }

    const order = await createExternalOrder(getSupabaseAdmin(), userId, {
      ref,
      supplier,
      title,
      asin,
      qty,
      amount,
      currency,
      status: "placed",
      milestones: [
        {
          stage: "placed",
          at: new Date().toISOString(),
          source: identity.via === "api-key" ? "automation" : "manual",
        },
      ],
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not register the external order." },
      { status: 500 }
    );
  }
}
