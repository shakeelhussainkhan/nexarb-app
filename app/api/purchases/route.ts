import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { evaluateDeal } from "@/lib/engine/verdict";
import {
  checkEligibility,
  spApiConfigFromEnv,
  EligibilityCache,
} from "@/lib/engine/eligibility";
import {
  canCreateIntent,
  capsFromEnv,
  killSwitchFromEnv,
  buildAuditEntry,
  newIntentId,
  sharedMemoryStore,
  startOfUtcDay,
  supabaseIsConfigured,
  type PurchaseIntentRecord,
  type SpendUsage,
} from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";

// Eligibility cache shared across intent requests in this process.
const eligibilityCache = new EligibilityCache();

// POST /api/purchases
// Creates a purchase intent (status PENDING_APPROVAL — nothing is bought).
// The intent is created ONLY when every guard passes:
//   - engine verdict (computed server-side) is BUY
//   - eligibility is synchronously re-checked here (direct lib import, not
//     HTTP) and is not BLOCKED or UNKNOWN
//   - spend caps pass (daily / per-order / per-ASIN; defaults — founder to
//     confirm)
//   - the purchasing kill switch is off
// Otherwise 422 with the full list of blockers.
// Persists to Supabase when configured, otherwise to a per-process in-memory
// store (honest fallback for local dev; see lib/engine/guards.ts).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const asin = String(body.asin ?? "").trim().toUpperCase();
  const qty = Number(body.qty);
  const unitPrice = Number(body.unitPrice);
  const buyPrice = body.buyPrice === undefined ? unitPrice : Number(body.buyPrice);
  const sellPrice = Number(body.sellPrice);
  const bsr = body.bsr === undefined || body.bsr === null ? undefined : Number(body.bsr);
  const category = body.category === undefined || body.category === null ? undefined : String(body.category);

  const problems: string[] = [];
  if (!/^[A-Z0-9]{10}$/.test(asin)) problems.push("Valid 10-character asin required.");
  if (!(qty > 0) || !Number.isFinite(qty)) problems.push("qty must be a positive number.");
  if (!(unitPrice > 0) || !Number.isFinite(unitPrice)) problems.push("unitPrice must be a positive number.");
  if (!(sellPrice > 0) || !Number.isFinite(sellPrice)) problems.push("sellPrice must be a positive number.");
  if (problems.length > 0) {
    return NextResponse.json({ error: "Invalid input", reasons: problems }, { status: 400 });
  }

  // Engine verdict is computed server-side from the deal inputs — the client
  // never gets to assert its own verdict.
  const evaluation = evaluateDeal({ buyPrice, sellPrice, bsr, category }, { qty });
  const verdict = evaluation.verdict;

  // Synchronous eligibility re-check for THIS intent: the eligibility lib is
  // imported directly (no HTTP hop), so a stale client-side answer can never
  // slip through. Until SP-API credentials exist this resolves to UNKNOWN,
  // which blocks intent creation — that is the intended safe default.
  const eligibility = await checkEligibility(spApiConfigFromEnv(process.env), asin, eligibilityCache);

  const caps = capsFromEnv(process.env);
  const killSwitchOn = killSwitchFromEnv(process.env);
  const useSupabase = supabaseIsConfigured(process.env);
  const since = startOfUtcDay(new Date());

  let usage: SpendUsage;
  try {
    usage = useSupabase ? await usageFromSupabase(asin, since) : sharedMemoryStore.usageFor(asin, since);
  } catch (e) {
    return NextResponse.json(
      { error: "Could not tally committed spend", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 503 }
    );
  }

  const decision = canCreateIntent({
    verdict,
    eligibility: eligibility.state,
    asin,
    qty,
    unitPrice,
    caps,
    usage,
    killSwitchOn,
    recheckDone: true, // we just re-checked eligibility above
  });

  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: "Purchase intent blocked by guardrails",
        reasons: decision.reasons,
        verdict,
        verdictReasons: evaluation.reasons,
        eligibility,
      },
      { status: 422 }
    );
  }

  const id = newIntentId();
  let intent: PurchaseIntentRecord;
  try {
    intent = useSupabase
      ? await insertIntentSupabase(id, { asin, qty, unitPrice, verdict, eligibility: eligibility.state, createdBy: userId })
      : sharedMemoryStore.createIntent({ asin, qty, unitPrice, verdict, eligibility: eligibility.state, createdBy: userId });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not record intent", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 503 }
    );
  }

  const audit = buildAuditEntry(id, "intent.created", userId, null);
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
    // Intent is recorded but the audit trail failed — surface it loudly.
    return NextResponse.json(
      { intent, warning: `Audit entry failed: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 201 }
    );
  }

  return NextResponse.json(
    { intent, eligibility, capsNote: "Spend caps are defaults — founder to confirm." },
    { status: 201 }
  );
}

async function usageFromSupabase(asin: string, since: Date): Promise<SpendUsage> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("purchases")
    .select("asin, qty, unit_price")
    .gte("created_at", since.toISOString())
    .neq("status", "REJECTED");
  if (error) throw new Error(`Supabase usage query failed: ${error.message}`);
  let spentToday = 0;
  let unitsForAsinToday = 0;
  for (const row of data ?? []) {
    const line = Number(row.qty) * Number(row.unit_price);
    if (Number.isFinite(line)) spentToday += line;
    if (row.asin === asin && Number.isFinite(Number(row.qty))) unitsForAsinToday += Number(row.qty);
  }
  return { spentToday, unitsForAsinToday };
}

async function insertIntentSupabase(
  id: string,
  input: { asin: string; qty: number; unitPrice: number; verdict: "BUY" | "SKIP" | "UNKNOWN"; eligibility: string; createdBy: string }
): Promise<PurchaseIntentRecord> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("purchases")
    .insert({
      id,
      asin: input.asin,
      qty: input.qty,
      unit_price: input.unitPrice,
      verdict: input.verdict,
      eligibility: input.eligibility,
      status: "PENDING_APPROVAL",
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) throw new Error(`Supabase intent insert failed: ${error.message}`);
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
  };
}
