import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { checkEligibility, spApiConfigFromEnv, EligibilityCache } from "@/lib/engine/eligibility";
import {
  buildAuditEntry,
  canCreateIntent,
  capsFromEnv,
  killSwitchFromEnv,
  newIntentId,
  startOfUtcDay,
  supabaseIsConfigured,
  type SpendUsage,
} from "@/lib/engine/guards";
import {
  canTransitionOrder,
  evaluateDraftEconomics,
  evaluateImportBenchmarkEligibility,
} from "@/lib/alibaba/ordersCore";
import { detectCategory, type ProductCategory } from "@/lib/compliance/core";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrder, updateOrder } from "@/lib/alibaba/orders";

// POST /api/alibaba/orders/[id]/intent  (session only)
//
// Convert a priced draft into a purchase intent THROUGH the existing
// purchases pipeline — the same server-side gates POST /api/purchases
// applies, imported from the same modules:
//   1. economics verdict (evaluateDraftEconomics) computed here from the
//      draft's landed cost vs its expected Amazon sell price — the same
//      fee-stack math and 20% target margin as the retail verdict, minus
//      the velocity leg (a not-yet-listed import has no BSR of its own) —
//      must be BUY;
//   2. Amazon eligibility synchronously re-checked (never cached-only),
//      then read through IMPORT semantics (evaluateImportBenchmark-
//      Eligibility, founder decision 2026-10-15): the checked ASIN is a
//      benchmark — a pricing reference for a product that will list as a
//      NEW own-brand ASIN — so a brand-level BLOCK on an open category
//      warns instead of refusing, while a compliance-BLOCKED product or
//      a category a new listing cannot enter still refuses;
//   3. guardrail caps from capsFromEnv (daily / per-order; the per-ASIN
//      unit cap is a retail guardrail and does not apply to import
//      intents — see exemptUnitsCap in lib/engine/guards) — the caps'
//      single source of truth, never hardcoded here;
//   4. purchasing kill switch.
// The intent lands in `purchases` as PENDING_APPROVAL; the founder
// approves or rejects it in the normal Purchases flow. This route never
// places anything: placement is a separate step that requires the
// intent to be APPROVED.

const eligibilityCache = new EligibilityCache();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity" || identity.via !== "session") {
    return NextResponse.json(
      { success: false, error: "Creating a purchase intent requires a signed-in session." },
      { status: 403 }
    );
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ success: false, error: "Order id required." }, { status: 400 });
  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const order = await getOrder(admin, identity.userId, id);
  if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });

  if (order.purchaseIntentId) {
    return NextResponse.json(
      { success: false, error: "This order already has a purchase intent linked.", intentId: order.purchaseIntentId },
      { status: 409 }
    );
  }
  if (!canTransitionOrder(order.status, "pending_approval")) {
    return NextResponse.json(
      { success: false, error: `Order is ${order.status} — only a draft can become a purchase intent.` },
      { status: 422 }
    );
  }
  if (!order.targetAsin || !order.expectedSellPrice) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This draft has no target Amazon ASIN / expected sell price, so the engine cannot verdict it. Re-draft it from the Alibaba page with the ASIN and expected sell price set.",
      },
      { status: 422 }
    );
  }

  // Gates 1+2: verdict + live eligibility re-check.
  const evaluation = evaluateDraftEconomics({
    landedPerUnit: order.landedPerUnit,
    expectedSellPrice: order.expectedSellPrice,
  });
  const eligibility = await checkEligibility(spApiConfigFromEnv(process.env), order.targetAsin, eligibilityCache);

  // Import semantics for the benchmark's eligibility (ordersCore): a
  // brand-level BLOCK on an open category becomes a warning the founder
  // approves with open eyes; a compliance-blocked product or a gated
  // category refuses here, before caps are even tallied.
  const category = (order.screeningCategory as ProductCategory | null) ?? detectCategory(order.title);
  const benchmark = evaluateImportBenchmarkEligibility({
    eligibilityState: eligibility.state,
    benchmarkAsin: order.targetAsin,
    screeningVerdict: order.screeningVerdict,
    screeningReasons: order.screeningReasons,
    category,
  });
  if (benchmark.outcome === "refuse") {
    return NextResponse.json(
      {
        success: false,
        error: "Purchase intent blocked by guardrails",
        reasons: [benchmark.refusalReason as string],
        verdict: evaluation.verdict,
        verdictReasons: evaluation.reasons,
        eligibility,
        warnings: [],
      },
      { status: 422 }
    );
  }
  const warnings: string[] = benchmark.warning ? [benchmark.warning] : [];

  // Gate 3+4: caps + kill switch, usage tallied exactly like /api/purchases.
  const caps = capsFromEnv(process.env);
  const killSwitchOn = killSwitchFromEnv(process.env);
  const since = startOfUtcDay(new Date());
  let usage: SpendUsage;
  try {
    usage = await usageFromSupabase(order.targetAsin, since);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Could not tally committed spend", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 503 }
    );
  }

  const decision = canCreateIntent({
    verdict: evaluation.verdict,
    eligibility: eligibility.state,
    asin: order.targetAsin,
    qty: order.qty,
    unitPrice: order.landedPerUnit,
    caps,
    usage,
    killSwitchOn,
    recheckDone: true, // eligibility was just re-checked above
    exemptUnitsCap: true, // import intent: bulk qty is the point; dollar caps still bind
    waiveEligibilityBlock: benchmark.outcome === "warn", // brand-level benchmark block, open category (above)
  });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Purchase intent blocked by guardrails",
        reasons: decision.reasons,
        verdict: evaluation.verdict,
        verdictReasons: evaluation.reasons,
        eligibility,
        warnings,
      },
      { status: 422 }
    );
  }

  const intentId = newIntentId();
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("purchases").insert({
      id: intentId,
      asin: order.targetAsin,
      qty: order.qty,
      unit_price: order.landedPerUnit,
      verdict: evaluation.verdict,
      eligibility: eligibility.state,
      status: "PENDING_APPROVAL",
      created_by: identity.userId,
      retailer_url: order.detailUrl,
    });
    if (error) throw new Error(error.message);
    const auditReason = benchmark.warning
      ? `From Alibaba order ${order.ref} — ELIGIBILITY WARNING: ${benchmark.warning}`
      : `From Alibaba order ${order.ref}`;
    const audit = buildAuditEntry(intentId, "intent.created", identity.userId, auditReason);
    const { error: auditError } = await sb.from("purchase_audit").insert({
      purchase_id: intentId,
      action: audit.action,
      actor: audit.actor,
      reason: audit.reason,
    });
    if (auditError) throw new Error(auditError.message);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Could not record intent", reasons: [e instanceof Error ? e.message : "unknown error"] },
      { status: 503 }
    );
  }

  // The warning is persisted on the order's raw blob (the established
  // pattern for derived order facts — freightQuote, payUrl, lastSync):
  // merged, never overwriting what placement/sync recorded there, and
  // surfaced on the Alibaba page via the record's eligibilityWarning.
  const prevRaw =
    order.alibabaStatusRaw && typeof order.alibabaStatusRaw === "object" && !Array.isArray(order.alibabaStatusRaw)
      ? (order.alibabaStatusRaw as Record<string, unknown>)
      : {};
  const updated = await updateOrder(admin, identity.userId, order.id, {
    purchase_intent_id: intentId,
    status: "pending_approval",
    ...(benchmark.warning ? { alibaba_status_raw: { ...prevRaw, eligibilityWarning: benchmark.warning } } : {}),
  });
  return NextResponse.json(
    { success: true, order: updated ?? order, intentId, caps, warnings },
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
