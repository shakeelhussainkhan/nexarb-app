// Offline harness for the order-lifecycle core (lib/lifecycle/core.ts).
// Run: node scripts/verify-lifecycle.mjs
// Pure-logic tests — NO network, NO database. The core has no imports,
// so Node's type stripping is all it needs. The central promise under
// test is the NO-INVENTED-STAGES rule: a journey only contains stages
// a source record evidences (an awaiting_payment order has NO paid
// stage; each distinct payment-evidence variant produces one).
import {
  CANONICAL_STAGES,
  PIPELINE_STAGES,
  STALE_THRESHOLDS_DAYS,
  isCanonicalStage,
  journeyFromAlibabaOrder,
  journeyFromIntent,
  journeyFromExternalOrder,
  parseMilestones,
  sortJourneys,
  journeyHasException,
} from "../lib/lifecycle/core.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const stagesOf = (j) => j.stages.map((s) => s.stage);
const entry = (j, stage) => j.stages.find((s) => s.stage === stage);
const NOW = new Date("2026-10-15T12:00:00.000Z");

// ── Vocabulary ──────────────────────────────────────────────────────────
check("vocabulary: canonical order is the designed pipeline + exceptions",
  JSON.stringify(CANONICAL_STAGES) === JSON.stringify([
    "draft", "pending_approval", "approved", "placed", "paid", "shipped",
    "at_warehouse", "prepped", "to_amazon", "listed", "selling",
    "returned", "cancelled", "failed", "problem",
  ]));
check("vocabulary: pipeline excludes exception states",
  PIPELINE_STAGES.length === 11 && !PIPELINE_STAGES.includes("failed"));
check("vocabulary: isCanonicalStage guards",
  isCanonicalStage("placed") && !isCanonicalStage("ready_to_place") && !isCanonicalStage("") && !isCanonicalStage(null));

// ── Alibaba builders ────────────────────────────────────────────────────
function aliOrder(over = {}) {
  return {
    id: "ord-1", ref: "AO-TEST-1", title: "Packing cubes 5pc", status: "draft",
    targetAsin: "B081NZ4YMH", qty: 350, orderTotal: 1333.11, supplierName: "Naduo",
    screeningVerdict: "clear",
    createdAt: "2026-10-14T09:00:00.000Z", updatedAt: "2026-10-14T09:00:00.000Z",
    placedAt: null, alibabaStatusRaw: null, lastSync: null,
    ...over,
  };
}

// Draft: only the draft stage exists — nothing invented downstream.
{
  const j = journeyFromAlibabaOrder(aliOrder(), null, null, { now: NOW });
  check("alibaba draft: stages are exactly [draft]",
    JSON.stringify(stagesOf(j)) === JSON.stringify(["draft"]));
  check("alibaba draft: currentStage draft, no exceptions",
    j.currentStage === "draft" && j.exceptions.length === 0);
  check("alibaba draft: identity fields carried",
    j.kind === "alibaba" && j.ref === "AO-TEST-1" && j.asin === "B081NZ4YMH" && j.qty === 350 && j.amount === 1333.11);
}

// Approved but not placed (incl. ready_to_place): approved is as far as
// the evidence goes — no placed, no paid.
for (const st of ["approved", "ready_to_place"]) {
  const j = journeyFromAlibabaOrder(aliOrder({ status: st }), null, null, { now: NOW });
  check(`alibaba ${st}: pending_approval + approved reached, nothing beyond`,
    JSON.stringify(stagesOf(j)) === JSON.stringify(["draft", "pending_approval", "approved"])
    && j.currentStage === "approved");
}

// KEY RULE: awaiting_payment has placed (created on Alibaba) but NO
// paid stage — payment is a separate act at Alibaba's cashier.
{
  const j = journeyFromAlibabaOrder(aliOrder({
    status: "awaiting_payment",
    placedAt: "2026-10-15T10:00:00.000Z",
    alibabaStatusRaw: { payUrl: "https://cashier.example/x" },
  }), null, null, { now: NOW });
  check("alibaba awaiting_payment: placed present at placed_at",
    entry(j, "placed")?.at === "2026-10-15T10:00:00.000Z");
  check("alibaba awaiting_payment: NO paid stage (no invented stages)",
    entry(j, "paid") === undefined && j.currentStage === "placed");
}

// Paid evidence variant 1: hand-settled flag in the raw payload.
{
  const j = journeyFromAlibabaOrder(aliOrder({
    status: "awaiting_payment",
    placedAt: "2026-10-15T10:00:00.000Z",
    alibabaStatusRaw: { paySettledManually: true, payEvidence: "Alibaba payment-received email 2026-10-15" },
    lastSync: { at: "2026-10-15T11:00:00.000Z", stage: "order_get", ok: false, detail: "e_trade_id missing" },
  }), null, null, { now: NOW });
  const paid = entry(j, "paid");
  check("alibaba paid via paySettledManually: paid stage with evidence detail",
    paid !== undefined && (paid.detail ?? "").includes("payment-received email"));
  check("alibaba hand-settled: sync failure still recorded as exception",
    j.exceptions.some((e) => e.includes("Status sync failing")));
}

// Paid evidence variant 2: payResult payload showing PAY_SUCCESS
// (nested IOP envelope shape).
{
  const j = journeyFromAlibabaOrder(aliOrder({
    status: "awaiting_payment",
    placedAt: "2026-10-15T10:00:00.000Z",
    alibabaStatusRaw: { payResult: { result: { value: { status: "PAY_SUCCESS" } } } },
    lastSync: { at: "2026-10-15T10:05:00.000Z", stage: "pay_result", ok: true, detail: "PAY_SUCCESS" },
  }), null, null, { now: NOW });
  check("alibaba paid via payResult PAY_SUCCESS: paid stage present",
    entry(j, "paid") !== undefined && entry(j, "paid").at === "2026-10-15T10:05:00.000Z"
    && j.exceptions.length === 0);
}

// Paid evidence variant 3: status beyond awaiting_payment implies the
// payment succeeded (the state machine only moves on PAY_SUCCESS) —
// and a non-success payResult must NOT create the stage by itself.
{
  const j = journeyFromAlibabaOrder(aliOrder({ status: "placed", placedAt: "2026-10-15T10:00:00.000Z" }),
    null, null, { now: NOW });
  check("alibaba placed status: paid stage implied with explanatory detail",
    entry(j, "paid") !== undefined && (entry(j, "paid").detail ?? "").includes("Implied by order status"));
  const unpaid = journeyFromAlibabaOrder(aliOrder({
    status: "awaiting_payment", placedAt: "2026-10-15T10:00:00.000Z",
    alibabaStatusRaw: { payResult: { status: "UNPAY" } },
  }), null, null, { now: NOW });
  check("alibaba payResult UNPAY: still no paid stage",
    entry(unpaid, "paid") === undefined);
}

// Linked intent supplies the approval stamps.
{
  const intent = {
    id: "pi_1", asin: "B081NZ4YMH", qty: 350, unitPrice: 3.81, status: "APPROVED",
    createdAt: "2026-10-14T10:00:00.000Z", decidedAt: "2026-10-14T12:30:00.000Z",
  };
  const j = journeyFromAlibabaOrder(aliOrder({ status: "approved" }), null, null, { intent, now: NOW });
  check("alibaba linked intent: pending_approval + approved carry intent timestamps",
    entry(j, "pending_approval")?.at === "2026-10-14T10:00:00.000Z"
    && entry(j, "approved")?.at === "2026-10-14T12:30:00.000Z"
    && entry(j, "approved")?.source.includes("linked intent"));
}

// Shipped + delivered shipment + sales: full arc to selling.
{
  const j = journeyFromAlibabaOrder(
    aliOrder({ status: "shipped", placedAt: "2026-10-15T10:00:00.000Z" }),
    { status: "delivered", updatedAt: "2026-11-18T08:00:00.000Z" },
    { asin: "B081NZ4YMH", unitsSold: 12, lastSoldAt: "2026-11-25T00:00:00.000Z" },
    { now: new Date("2026-11-26T00:00:00.000Z") }
  );
  check("alibaba shipped: shipped stage from status (no timestamp invented)",
    entry(j, "shipped") !== undefined && entry(j, "shipped").at === null);
  check("alibaba delivered shipment: at_warehouse stamped from shipment updated_at",
    entry(j, "at_warehouse")?.at === "2026-11-18T08:00:00.000Z");
  check("alibaba selling: sales aggregate reaches selling, currentStage selling",
    entry(j, "selling")?.detail?.includes("12 units") === true && j.currentStage === "selling");
  check("alibaba selling: never stale (steady state)", j.stale === false);
}

// Shipment in transit alone also evidences shipped.
{
  const j = journeyFromAlibabaOrder(
    aliOrder({ status: "placed", placedAt: "2026-10-15T10:00:00.000Z" }),
    { status: "in_transit", updatedAt: "2026-10-20T00:00:00.000Z" }, null, { now: NOW });
  check("alibaba shipment in_transit: shipped stage via import_shipments",
    entry(j, "shipped")?.source === "import_shipments.status");
}

// Sales for a DIFFERENT asin never leak onto a journey.
{
  const j = journeyFromAlibabaOrder(
    aliOrder({ status: "delivered", placedAt: "2026-10-15T10:00:00.000Z" }),
    null, { asin: "B0DIFFERENT", unitsSold: 5, lastSoldAt: "2026-11-01T00:00:00.000Z" }, { now: NOW });
  check("alibaba sales agg for another ASIN: no selling stage",
    entry(j, "selling") === undefined && entry(j, "at_warehouse") !== undefined);
}

// Failed + cancelled journeys.
{
  const f = journeyFromAlibabaOrder(aliOrder({ status: "failed", updatedAt: "2026-10-15T09:00:00.000Z" }),
    null, null, { now: NOW });
  check("alibaba failed: failed stage + exception flagged",
    entry(f, "failed") !== undefined && journeyHasException(f));
  const c = journeyFromAlibabaOrder(aliOrder({ status: "cancelled" }), null, null, { now: NOW });
  check("alibaba cancelled: cancelled stage recorded",
    entry(c, "cancelled") !== undefined && c.exceptions.some((e) => e.includes("cancelled")));
}

// ── Retail builders ─────────────────────────────────────────────────────
function intent(over = {}) {
  return {
    id: "pi_9", asin: "B0DT4W7FP3", qty: 10, unitPrice: 10, status: "PENDING_APPROVAL",
    createdAt: "2026-10-14T08:00:00.000Z", decidedAt: null, decisionReason: null,
    retailerUrl: "https://www.walmart.com/ip/123", checkoutStatus: "none",
    ...over,
  };
}
{
  const j = journeyFromIntent(intent(), null, null, NOW);
  check("retail pending: journey starts at pending_approval (no draft invented)",
    JSON.stringify(stagesOf(j)) === JSON.stringify(["pending_approval"]) && j.currentStage === "pending_approval");
  check("retail identity: retailer from URL host, amount = qty × unitPrice",
    j.supplierOrRetailer === "Walmart" && j.amount === 100 && j.title === "ASIN B0DT4W7FP3");
}
{
  const j = journeyFromIntent(intent({ status: "APPROVED", decidedAt: "2026-10-14T09:00:00.000Z" }), null, null, NOW);
  check("retail approved, checkout not run: no placed stage",
    entry(j, "placed") === undefined && j.currentStage === "approved");
}
{
  const done = journeyFromIntent(intent({ status: "APPROVED", decidedAt: "2026-10-14T09:00:00.000Z", checkoutStatus: "completed" }),
    null, { asin: "B0DT4W7FP3", unitsSold: 3, lastSoldAt: "2026-10-20T00:00:00.000Z" }, NOW);
  check("retail checkout completed: placed reached; sales then evidence selling",
    entry(done, "placed") !== undefined && entry(done, "selling") !== undefined && done.currentStage === "selling");
  const unsold = journeyFromIntent(intent({ status: "APPROVED", decidedAt: "2026-10-14T09:00:00.000Z" }),
    null, { asin: "B0DT4W7FP3", unitsSold: 3, lastSoldAt: "2026-10-20T00:00:00.000Z" }, NOW);
  check("retail sales without placement: NO selling stage (sales can't precede the buy)",
    entry(unsold, "selling") === undefined);
  const executed = journeyFromIntent(intent({ status: "EXECUTED", decidedAt: "2026-10-14T09:30:00.000Z" }), null, null, NOW);
  check("retail EXECUTED: placed reached via status",
    entry(executed, "placed") !== undefined);
}
{
  const rej = journeyFromIntent(intent({ status: "REJECTED", decidedAt: "2026-10-14T09:00:00.000Z", decisionReason: "margin too thin" }),
    null, null, NOW);
  check("retail rejected: cancelled stage quotes the decision reason",
    entry(rej, "cancelled")?.detail?.includes("margin too thin") === true);
  const failed = journeyFromIntent(intent({ status: "APPROVED", decidedAt: "2026-10-14T09:00:00.000Z", checkoutStatus: "failed" }),
    null, null, NOW);
  check("retail checkout failed: problem stage + exception",
    entry(failed, "problem") !== undefined && journeyHasException(failed));
  const viaCheckoutArg = journeyFromIntent(intent({ status: "APPROVED", decidedAt: "2026-10-14T09:00:00.000Z" }),
    { status: "completed" }, null, NOW);
  check("retail checkout arg overrides the intent's own checkoutStatus",
    entry(viaCheckoutArg, "placed") !== undefined);
}

// ── External builders ───────────────────────────────────────────────────
{
  const row = {
    id: "eo_1", ref: "FS-PETRA-2026-001", supplier: "Petra Industries", title: "Petra basket — 7 lines",
    asin: null, qty: 27, amount: 811.72, status: "placed",
    milestones: [{ stage: "placed", at: "2026-10-15T16:13:00.000Z", source: "manual" }],
    updatedAt: "2026-10-15T16:13:00.000Z",
  };
  const j = journeyFromExternalOrder(row, NOW);
  check("external placed: journey from milestones verbatim",
    j.kind === "external" && j.currentStage === "placed" && entry(j, "placed")?.source === "manual"
    && j.supplierOrRetailer === "Petra Industries" && j.amount === 811.72);
}
{
  const row = {
    id: "eo_2", ref: "PO-2", supplier: "EE Distribution", title: "Toy order", asin: null,
    qty: null, amount: null, status: "shipped", milestones: [], updatedAt: "2026-10-12T00:00:00.000Z",
  };
  const j = journeyFromExternalOrder(row, NOW);
  check("external status-only record: stage appended from status field",
    JSON.stringify(stagesOf(j)) === JSON.stringify(["shipped"]) && j.currentStage === "shipped");
  const messy = journeyFromExternalOrder({
    ...row, status: "placed",
    milestones: [
      { stage: "warp_drive", at: "2026-10-11T00:00:00.000Z", source: "email" },
      { stage: "paid", at: "2026-10-11T01:00:00.000Z", source: "email", detail: "card charged" },
      "garbage",
      { at: "2026-10-11T02:00:00.000Z" },
    ],
  }, NOW);
  check("external milestones: unknown stages + malformed entries dropped",
    JSON.stringify(stagesOf(messy)) === JSON.stringify(["placed", "paid"])
    && entry(messy, "paid")?.detail === "card charged");
  check("parseMilestones: non-array yields []", parseMilestones("nope").length === 0 && parseMilestones(null).length === 0);
}

// ── Dwell / stale ───────────────────────────────────────────────────────
{
  const old = journeyFromAlibabaOrder(aliOrder({
    status: "placed", placedAt: "2026-08-20T12:00:00.000Z",
  }), null, null, { now: NOW });
  check("dwell: placed 56 days ago → dwellDays 56, stale (threshold 45)",
    old.dwellDays === 56 && old.stale === true && STALE_THRESHOLDS_DAYS.placed === 45);
  const fresh = journeyFromAlibabaOrder(aliOrder({
    status: "awaiting_payment", placedAt: "2026-10-14T12:00:00.000Z",
  }), null, null, { now: NOW });
  check("dwell: placed yesterday → dwellDays 1, not stale",
    fresh.dwellDays === 1 && fresh.stale === false);
  const pending = journeyFromIntent(intent({ createdAt: "2026-10-10T12:00:00.000Z" }), null, null, NOW);
  check("dwell: pending_approval 5 days → stale (threshold 3)",
    pending.currentStage === "pending_approval" && pending.dwellDays === 5 && pending.stale === true);
  const noStamps = journeyFromAlibabaOrder(aliOrder({
    status: "approved", createdAt: "not-a-date", updatedAt: "not-a-date",
  }), null, null, { now: NOW });
  check("dwell: no usable timestamps anywhere → dwellDays null, not stale",
    noStamps.dwellDays === null && noStamps.stale === false);
}

// ── Sorting ─────────────────────────────────────────────────────────────
{
  const failedJ = journeyFromAlibabaOrder(aliOrder({ ref: "AO-Z", status: "failed", updatedAt: "2026-10-01T00:00:00.000Z" }),
    null, null, { now: NOW });
  const recentJ = journeyFromAlibabaOrder(aliOrder({ ref: "AO-A", status: "placed", placedAt: "2026-10-15T10:00:00.000Z" }),
    null, null, { now: NOW });
  const olderJ = journeyFromAlibabaOrder(aliOrder({ ref: "AO-B", status: "placed", placedAt: "2026-10-10T10:00:00.000Z" }),
    null, null, { now: NOW });
  const sorted = sortJourneys([olderJ, recentJ, failedJ]);
  check("sort: exception journey first despite oldest activity",
    sorted[0].ref === "AO-Z" && journeyHasException(sorted[0]));
  check("sort: then latest stage timestamp desc",
    sorted[1].ref === "AO-A" && sorted[2].ref === "AO-B");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
