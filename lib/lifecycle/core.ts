// Order lifecycle — pure core.
//
// One canonical journey vocabulary for every order Five S places,
// however it was placed: app-placed Alibaba imports (alibaba_orders),
// retail purchase intents (purchases), and orders placed outside the
// app (external_orders, migration 023). Until now each surface showed
// its own status text chips and no screen could answer "where is this
// order, end to end?" — and external orders had no record at all.
//
// Pure functions only — no I/O, no imports — so
// scripts/verify-lifecycle.mjs can exercise everything offline (same
// pattern as lib/inventory/lotsCore.ts, lib/alibaba/ordersCore.ts).
// The server assembly lives in app/api/orders/journeys/route.ts and
// lib/lifecycle/external.ts.
//
// HARD RULE — NO INVENTED STAGES: a stage appears on a journey ONLY
// when a source record evidences it. Sources frequently cannot prove a
// stage (no timestamp column, no feed); the stage is then simply
// ABSENT, and `currentStage` is the furthest stage that IS evidenced.
// Stage entries carry `at: null` when the stage is proven by a status
// value but no dedicated timestamp column exists.
//
// ── MAPPING TABLE (source vocabulary → canonical stages) ──────────────
//
// Canonical pipeline, in order:
//   draft → pending_approval → approved → placed → paid → shipped →
//   at_warehouse → prepped → to_amazon → listed → selling
// Terminal / exception states: returned, cancelled, failed, problem.
//
// ALIBABA (alibaba_orders, migration 020/021; statuses: draft,
// pending_approval, approved, ready_to_place, awaiting_payment,
// placed, shipped, delivered, failed, cancelled):
//   draft            ← the row itself (at = created_at)
//   pending_approval ← linked purchase intent created (at = intent
//                      created_at); else status ≥ pending_approval (at null)
//   approved         ← linked intent APPROVED/EXECUTED (at = decided_at);
//                      else status ≥ approved (at null). ready_to_place
//                      counts as approved (it is the APIs-dark holding
//                      state AFTER approval — nothing is on Alibaba yet,
//                      so it is NOT placed and NOT paid)
//   placed           ← placed_at (the order was created on Alibaba);
//                      else status ∈ {awaiting_payment, placed, shipped,
//                      delivered} (at null)
//   paid             ← ONLY from payment evidence, never from placement:
//                        · alibaba_status_raw.paySettledManually = true
//                          (founder hand-settled; detail quotes the
//                          recorded payEvidence), or
//                        · alibaba_status_raw.payResult shows
//                          PAY_SUCCESS (pay/result/query), or
//                        · status beyond awaiting_payment (placed /
//                          shipped / delivered) — the state machine
//                          only leaves awaiting_payment on PAY_SUCCESS,
//                          so a later status IS payment evidence
//                          (detail says so). awaiting_payment ALONE
//                          NEVER yields a paid stage.
//   shipped          ← status ∈ {shipped, delivered}; or the linked
//                      import_shipments status ∈ {in_transit,
//                      entry_filed, released, delivered} (goods are on
//                      the water / in customs). No shipped_at column
//                      exists anywhere → at is null.
//   at_warehouse     ← import_shipments.status = delivered (delivered
//                      to the destination = the Automated 3PL warehouse;
//                      at = shipment updated_at — import_shipments has
//                      NO delivered_at column, the detail says the
//                      stamp is the record's last update); else
//                      alibaba order status = delivered (at = order
//                      updated_at, same caveat)
//   selling          ← sales_events aggregate for the target ASIN with
//                      unitsSold > 0 (at = last sold_at)
//   failed/cancelled ← the order's own terminal status (at = updated_at)
//   exceptions       ← failed/cancelled status; screening_verdict
//                      blocked; a recorded lastSync failure while the
//                      order is not terminal (sync observability,
//                      lib/alibaba/ordersCore buildSyncAttempt)
//   GAPS (no feed — stage omitted, never inferred):
//     prepped / to_amazon — warehouse_shipments (migration 005) tracks
//       the 3PL prep flow but is a manual table with no order link.
//     listed — listings exist per ASIN, but no listing↔order link;
//       deliberately NOT inferred from ASIN + lot in D1.
//     returned — no returns feed (Finances return events are not
//       aggregated per ASIN by the PR-A ingestion).
//
// RETAIL (purchases, migration 004 + checkout_status from 008;
// statuses PENDING_APPROVAL, APPROVED, EXECUTED, REJECTED;
// checkout_status none/requested/in_progress/awaiting_payment/
// completed/failed). Retail compresses: there is no separate
// payment/production leg — the founder pays at the retailer's
// checkout, so checkout completion IS placement:
//   pending_approval ← the intent itself (at = created_at)
//   approved         ← status APPROVED/EXECUTED (at = decided_at)
//   placed           ← checkout_status = completed (at null — purchases
//                      has no completed_at column; purchase_audit has
//                      the stamp but is not loaded in D1); or status
//                      EXECUTED (at = decided_at)
//   selling          ← sales_events aggregate for the ASIN, only once
//                      placed is reached (at = last sold_at)
//   cancelled        ← status REJECTED (at = decided_at)
//   problem          ← checkout_status = failed (+ exception)
//   GAPS: paid (compressed into placed, see above); shipped /
//     at_warehouse / prepped / to_amazon / listed / returned — no
//     linked feed for retail purchases (same warehouse/listings gaps
//     as Alibaba).
//
// EXTERNAL (external_orders, migration 023): milestones ARE canonical
// stage entries stored verbatim ({stage, at, source, detail}); unknown
// stage strings are dropped. If the row's free-text `status` names a
// canonical stage with no milestone, one entry is appended from it
// (at = updated_at, source "external_orders.status") so a status-only
// record still renders.
//
// SALES (sales_events, migration 005 + amazon_order_id from 022):
// per-ASIN aggregate {unitsSold = Σ qty, lastSoldAt = max(sold_at)}
// feeds the `selling` stage of every kind. sales_events has no
// user_id — the app is single-operator and the P&L reads it the same
// way.
//
// DWELL / STALE: dwellDays = whole days since the current stage began
// (its `at`; walking back to an earlier stage's stamp when the current
// stage has none; null when no stage carries a stamp). `stale` is a
// data flag only — dwellDays exceeds the per-stage threshold below.
// selling and the terminal states have no threshold (they are
// steady/end states, not waiting states).

// --- Canonical vocabulary ------------------------------------------------------

export const CANONICAL_STAGES = [
  "draft",
  "pending_approval",
  "approved",
  "placed",
  "paid",
  "shipped",
  "at_warehouse",
  "prepped",
  "to_amazon",
  "listed",
  "selling",
  "returned",
  "cancelled",
  "failed",
  "problem",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGES)[number];

/** The forward pipeline (canonical order). Exception states are not
 * ranked — a journey's currentStage is its furthest PIPELINE stage. */
export const PIPELINE_STAGES: CanonicalStage[] = [
  "draft",
  "pending_approval",
  "approved",
  "placed",
  "paid",
  "shipped",
  "at_warehouse",
  "prepped",
  "to_amazon",
  "listed",
  "selling",
];

export const EXCEPTION_STAGES: CanonicalStage[] = ["returned", "cancelled", "failed", "problem"];

export function isCanonicalStage(v: unknown): v is CanonicalStage {
  return typeof v === "string" && (CANONICAL_STAGES as readonly string[]).includes(v);
}

function pipelineRank(stage: CanonicalStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

// --- Types ---------------------------------------------------------------------

export interface StageEntry {
  stage: CanonicalStage;
  /** ISO timestamp the stage was reached, or null when the stage is
   * proven by a status value but no timestamp column exists. */
  at: string | null;
  /** Which record evidences this stage (e.g. "alibaba_orders.placed_at"). */
  source: string;
  detail?: string;
}

export interface SalesAggregate {
  asin: string;
  unitsSold: number;
  lastSoldAt: string | null;
}

export interface OrderJourney {
  id: string;
  kind: "alibaba" | "retail" | "external";
  title: string;
  ref: string;
  supplierOrRetailer: string;
  asin: string | null;
  qty: number | null;
  amount: number | null;
  stages: StageEntry[];
  /** Furthest REACHED pipeline stage (exception stage only when no
   * pipeline stage was reached at all). */
  currentStage: CanonicalStage;
  /** Whole days since the current stage began; null when no stage on
   * the journey carries a timestamp. */
  dwellDays: number | null;
  /** dwellDays exceeds the per-stage threshold (see STALE_THRESHOLDS_DAYS). */
  stale: boolean;
  exceptions: string[];
}

/** Days a journey may sit in a stage before `stale` flags it. Stages
 * absent here never go stale (selling + terminal states). */
export const STALE_THRESHOLDS_DAYS: Partial<Record<CanonicalStage, number>> = {
  draft: 14,
  pending_approval: 3,
  approved: 7,
  placed: 45,
  paid: 45,
  shipped: 45,
  at_warehouse: 21,
  prepped: 14,
  to_amazon: 14,
  listed: 30,
};

// --- Shared assembly -------------------------------------------------------------

const DAY_MS = 86_400_000;

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v)) ? v : null;
}

interface JourneyBase {
  id: string;
  kind: OrderJourney["kind"];
  title: string;
  ref: string;
  supplierOrRetailer: string;
  asin: string | null;
  qty: number | null;
  amount: number | null;
}

/** Dedupe (first entry per stage wins), sort (pipeline order, then
 * exception states), derive currentStage / dwellDays / stale. */
export function finishJourney(
  base: JourneyBase,
  entries: StageEntry[],
  exceptions: string[],
  now: Date = new Date()
): OrderJourney {
  const byStage = new Map<CanonicalStage, StageEntry>();
  for (const e of entries) {
    if (!isCanonicalStage(e.stage)) continue;
    if (!byStage.has(e.stage)) byStage.set(e.stage, e);
  }
  const stages = [...byStage.values()].sort((a, b) => {
    const ra = pipelineRank(a.stage);
    const rb = pipelineRank(b.stage);
    if (ra >= 0 && rb >= 0) return ra - rb;
    if (ra >= 0) return -1;
    if (rb >= 0) return 1;
    return EXCEPTION_STAGES.indexOf(a.stage) - EXCEPTION_STAGES.indexOf(b.stage);
  });

  let currentStage: CanonicalStage = "draft";
  let bestRank = -1;
  for (const s of stages) {
    const r = pipelineRank(s.stage);
    if (r > bestRank) {
      bestRank = r;
      currentStage = s.stage;
    }
  }
  if (bestRank < 0 && stages.length > 0) currentStage = stages[0].stage;

  // Dwell: the current stage's stamp, else walk back to the newest
  // stamp at or before it (the stage provably began no later than that).
  let dwellDays: number | null = null;
  const idx = stages.findIndex((s) => s.stage === currentStage);
  for (let i = idx; i >= 0; i--) {
    const at = isoOrNull(stages[i].at);
    if (at) {
      dwellDays = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / DAY_MS));
      break;
    }
  }

  const threshold = STALE_THRESHOLDS_DAYS[currentStage];
  const stale = dwellDays !== null && threshold !== undefined && dwellDays > threshold;

  return { ...base, stages, currentStage, dwellDays, stale, exceptions };
}

/** A journey needs attention when it carries recorded exceptions or is
 * sitting in a failed/problem/returned state. (A plain cancellation is
 * a decision, not an alarm, unless an exception was recorded.) */
export function journeyHasException(j: OrderJourney): boolean {
  return (
    j.exceptions.length > 0 ||
    j.currentStage === "failed" ||
    j.currentStage === "problem" ||
    j.currentStage === "returned"
  );
}

function latestStageAt(j: OrderJourney): string {
  let latest = "";
  for (const s of j.stages) {
    const at = isoOrNull(s.at);
    if (at && at > latest) latest = at;
  }
  return latest;
}

/** Exceptions first, then by latest stage timestamp desc (journeys
 * with no timestamps last), then ref for a stable order. */
export function sortJourneys(journeys: OrderJourney[]): OrderJourney[] {
  return [...journeys].sort((a, b) => {
    const ea = journeyHasException(a) ? 0 : 1;
    const eb = journeyHasException(b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    const la = latestStageAt(a);
    const lb = latestStageAt(b);
    if (la !== lb) return la < lb ? 1 : -1;
    return a.ref.localeCompare(b.ref);
  });
}

// --- Alibaba ----------------------------------------------------------------

/** Structural subset of lib/alibaba/orders.ts AlibabaOrderRecord —
 * declared here so the core stays import-free. */
export interface AlibabaJourneyOrder {
  id: string;
  ref: string;
  title: string;
  status: string;
  targetAsin: string | null;
  qty: number;
  orderTotal: number;
  supplierName: string | null;
  screeningVerdict: string;
  createdAt: string;
  updatedAt: string;
  placedAt: string | null;
  alibabaStatusRaw: unknown;
  lastSync: { at: string; stage: string; ok: boolean; detail: string } | null;
}

/** Structural subset of an import_shipments row (migration 015). */
export interface ShipmentJourneyInput {
  status: string;
  updatedAt: string;
}

/** Structural subset of a purchases row (PurchaseIntentRecord). */
export interface IntentJourneyInput {
  id: string;
  asin: string;
  qty: number;
  unitPrice: number;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy?: string | null;
  decisionReason?: string | null;
  retailerUrl?: string | null;
  checkoutStatus?: string | null;
}

const ALI_REACHED_PENDING = new Set([
  "pending_approval", "approved", "ready_to_place", "awaiting_payment", "placed", "shipped", "delivered",
]);
const ALI_REACHED_APPROVED = new Set([
  "approved", "ready_to_place", "awaiting_payment", "placed", "shipped", "delivered",
]);
const ALI_CREATED_ON_ALIBABA = new Set(["awaiting_payment", "placed", "shipped", "delivered"]);
const ALI_BEYOND_PAYMENT = new Set(["placed", "shipped", "delivered"]);
const SHIPMENT_IN_TRANSIT = new Set(["in_transit", "entry_filed", "released", "delivered"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Dig a payment status string out of a stored payResult payload — the
 * IOP envelope nests it differently across responses (same spots
 * lib/alibaba/ordersCore findRecordWith checks). */
function payResultStatus(raw: unknown): string | null {
  const root = asRecord(raw);
  if (!root) return null;
  const pr = asRecord(root.payResult);
  if (!pr) return null;
  const result = asRecord(pr.result);
  const candidates: Array<Record<string, unknown> | null> = [
    pr,
    asRecord(pr.value),
    result,
    result ? asRecord(result.value) : null,
    asRecord(pr.data),
  ];
  for (const c of candidates) {
    if (c && typeof c.status === "string" && c.status) return c.status;
  }
  return null;
}

export function journeyFromAlibabaOrder(
  order: AlibabaJourneyOrder,
  shipment?: ShipmentJourneyInput | null,
  salesAgg?: SalesAggregate | null,
  opts?: { intent?: IntentJourneyInput | null; now?: Date }
): OrderJourney {
  const intent = opts?.intent ?? null;
  const entries: StageEntry[] = [];
  const exceptions: string[] = [];
  const status = order.status;

  entries.push({ stage: "draft", at: isoOrNull(order.createdAt), source: "alibaba_orders" });

  if (intent) {
    entries.push({ stage: "pending_approval", at: isoOrNull(intent.createdAt), source: "purchases (linked intent)" });
    if (intent.status === "APPROVED" || intent.status === "EXECUTED") {
      entries.push({ stage: "approved", at: isoOrNull(intent.decidedAt), source: "purchases (linked intent)" });
    }
  } else {
    if (ALI_REACHED_PENDING.has(status)) {
      entries.push({ stage: "pending_approval", at: null, source: "alibaba_orders.status" });
    }
    if (ALI_REACHED_APPROVED.has(status)) {
      entries.push({ stage: "approved", at: null, source: "alibaba_orders.status" });
    }
  }

  if (isoOrNull(order.placedAt)) {
    entries.push({ stage: "placed", at: order.placedAt, source: "alibaba_orders.placed_at" });
  } else if (ALI_CREATED_ON_ALIBABA.has(status)) {
    entries.push({ stage: "placed", at: null, source: "alibaba_orders.status" });
  }

  // paid — evidence only (see the mapping table; awaiting_payment
  // alone NEVER produces this stage).
  const raw = asRecord(order.alibabaStatusRaw);
  if (raw && raw.paySettledManually === true) {
    const evidence = typeof raw.payEvidence === "string" && raw.payEvidence ? raw.payEvidence : null;
    entries.push({
      stage: "paid",
      at: order.lastSync ? isoOrNull(order.lastSync.at) : null,
      source: "alibaba_status_raw.paySettledManually",
      detail: evidence ?? "Payment settled manually (hand-verified outside the pay-result API).",
    });
  } else if (payResultStatus(order.alibabaStatusRaw) === "PAY_SUCCESS") {
    entries.push({
      stage: "paid",
      at: order.lastSync ? isoOrNull(order.lastSync.at) : null,
      source: "alibaba order/pay/result/query",
      detail: "PAY_SUCCESS",
    });
  } else if (ALI_BEYOND_PAYMENT.has(status)) {
    entries.push({
      stage: "paid",
      at: null,
      source: "alibaba_orders.status",
      detail: `Implied by order status "${status}" — awaiting_payment only transitions on PAY_SUCCESS.`,
    });
  }

  if (status === "shipped" || status === "delivered") {
    entries.push({ stage: "shipped", at: null, source: "alibaba_orders.status" });
  } else if (shipment && SHIPMENT_IN_TRANSIT.has(shipment.status)) {
    entries.push({
      stage: "shipped",
      at: null,
      source: "import_shipments.status",
      detail: `Shipment status "${shipment.status}" (in transit / customs).`,
    });
  }

  if (shipment && shipment.status === "delivered") {
    entries.push({
      stage: "at_warehouse",
      at: isoOrNull(shipment.updatedAt),
      source: "import_shipments.status",
      detail: "Shipment marked delivered to destination (stamp is the record's last update — no delivered_at column exists).",
    });
  } else if (status === "delivered") {
    entries.push({
      stage: "at_warehouse",
      at: isoOrNull(order.updatedAt),
      source: "alibaba_orders.status",
      detail: "Order marked delivered to destination (stamp is the record's last update — no delivered_at column exists).",
    });
  }

  if (salesAgg && order.targetAsin && salesAgg.asin === order.targetAsin && salesAgg.unitsSold > 0) {
    entries.push({
      stage: "selling",
      at: isoOrNull(salesAgg.lastSoldAt),
      source: "sales_events",
      detail: `${salesAgg.unitsSold} unit${salesAgg.unitsSold === 1 ? "" : "s"} sold for this ASIN.`,
    });
  }

  if (status === "failed") {
    entries.push({ stage: "failed", at: isoOrNull(order.updatedAt), source: "alibaba_orders.status" });
    exceptions.push("Alibaba order status: failed.");
  }
  if (status === "cancelled") {
    entries.push({ stage: "cancelled", at: isoOrNull(order.updatedAt), source: "alibaba_orders.status" });
    exceptions.push("Alibaba order cancelled.");
  }
  if (order.screeningVerdict === "blocked") {
    exceptions.push("Compliance screening BLOCKED this product.");
  }
  if (
    order.lastSync &&
    !order.lastSync.ok &&
    status !== "delivered" &&
    status !== "cancelled"
  ) {
    exceptions.push(
      `Status sync failing at ${order.lastSync.stage}: ${order.lastSync.detail || "no detail recorded"}`
    );
  }

  return finishJourney(
    {
      id: order.id,
      kind: "alibaba",
      title: order.title,
      ref: order.ref,
      supplierOrRetailer: order.supplierName ?? "Alibaba",
      asin: order.targetAsin,
      qty: order.qty,
      amount: order.orderTotal,
    },
    entries,
    exceptions,
    opts?.now
  );
}

// --- Retail -------------------------------------------------------------------

function retailerLabel(retailerUrl: string | null | undefined): string {
  if (!retailerUrl) return "Retail";
  try {
    const host = new URL(retailerUrl).hostname.replace(/^www\./, "");
    if (host.includes("walmart")) return "Walmart";
    if (host.includes("target")) return "Target";
    if (host.includes("costco")) return "Costco";
    if (host.includes("amazon")) return "Amazon";
    return host;
  } catch {
    return "Retail";
  }
}

export function journeyFromIntent(
  intent: IntentJourneyInput,
  checkout?: { status?: string | null } | null,
  salesAgg?: SalesAggregate | null,
  now?: Date
): OrderJourney {
  const entries: StageEntry[] = [];
  const exceptions: string[] = [];
  const checkoutStatus = checkout?.status ?? intent.checkoutStatus ?? "none";

  entries.push({ stage: "pending_approval", at: isoOrNull(intent.createdAt), source: "purchases" });

  if (intent.status === "APPROVED" || intent.status === "EXECUTED") {
    entries.push({ stage: "approved", at: isoOrNull(intent.decidedAt), source: "purchases" });
  }

  let placedReached = false;
  if (checkoutStatus === "completed") {
    entries.push({
      stage: "placed",
      at: null,
      source: "purchases.checkout_status",
      detail: "Assisted checkout completed (retail compresses placed+paid into the checkout).",
    });
    placedReached = true;
  } else if (intent.status === "EXECUTED") {
    entries.push({ stage: "placed", at: isoOrNull(intent.decidedAt), source: "purchases.status", detail: "Intent executed." });
    placedReached = true;
  }

  if (placedReached && salesAgg && salesAgg.asin === intent.asin && salesAgg.unitsSold > 0) {
    entries.push({
      stage: "selling",
      at: isoOrNull(salesAgg.lastSoldAt),
      source: "sales_events",
      detail: `${salesAgg.unitsSold} unit${salesAgg.unitsSold === 1 ? "" : "s"} sold for this ASIN.`,
    });
  }

  if (intent.status === "REJECTED") {
    entries.push({
      stage: "cancelled",
      at: isoOrNull(intent.decidedAt),
      source: "purchases",
      detail: intent.decisionReason ? `Intent rejected: ${intent.decisionReason}` : "Intent rejected.",
    });
    exceptions.push("Purchase intent rejected.");
  }
  if (checkoutStatus === "failed") {
    entries.push({ stage: "problem", at: null, source: "purchases.checkout_status", detail: "Assisted checkout failed." });
    exceptions.push("Assisted checkout failed.");
  }

  return finishJourney(
    {
      id: intent.id,
      kind: "retail",
      title: `ASIN ${intent.asin}`,
      ref: intent.id,
      supplierOrRetailer: retailerLabel(intent.retailerUrl),
      asin: intent.asin,
      qty: intent.qty,
      amount: Math.round(intent.qty * intent.unitPrice * 100) / 100,
    },
    entries,
    exceptions,
    now
  );
}

// --- External -------------------------------------------------------------------

/** Structural subset of an external_orders row (migration 023). */
export interface ExternalJourneyRow {
  id: string;
  ref: string;
  supplier: string;
  title: string;
  asin: string | null;
  qty: number | null;
  amount: number | null;
  status: string;
  milestones: unknown;
  updatedAt: string;
}

/** Validate a stored milestones jsonb value into StageEntry[] —
 * unknown stages and malformed entries are dropped, never rendered. */
export function parseMilestones(raw: unknown): StageEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StageEntry[] = [];
  for (const m of raw) {
    const rec = asRecord(m);
    if (!rec || !isCanonicalStage(rec.stage)) continue;
    out.push({
      stage: rec.stage,
      at: isoOrNull(rec.at),
      source: typeof rec.source === "string" && rec.source ? rec.source : "external_orders",
      ...(typeof rec.detail === "string" && rec.detail ? { detail: rec.detail } : {}),
    });
  }
  return out;
}

export function journeyFromExternalOrder(row: ExternalJourneyRow, now?: Date): OrderJourney {
  const entries = parseMilestones(row.milestones);
  const exceptions: string[] = [];

  if (isCanonicalStage(row.status) && !entries.some((e) => e.stage === row.status)) {
    entries.push({
      stage: row.status,
      at: isoOrNull(row.updatedAt),
      source: "external_orders.status",
      detail: "Stage from the order's status field (no milestone recorded).",
    });
  }
  if (EXCEPTION_STAGES.includes(row.status as CanonicalStage)) {
    exceptions.push(`External order status: ${row.status}.`);
  }

  return finishJourney(
    {
      id: row.id,
      kind: "external",
      title: row.title,
      ref: row.ref,
      supplierOrRetailer: row.supplier,
      asin: row.asin,
      qty: row.qty,
      amount: row.amount,
    },
    entries,
    exceptions,
    now
  );
}
