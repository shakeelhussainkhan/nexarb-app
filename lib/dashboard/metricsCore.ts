// Executive-dashboard metrics — pure core (PR-E1).
//
// Exact aggregations over plain row arrays for every NexArb module,
// behind GET /api/dashboard/metrics (PR-E2 renders them). Pure
// functions only — no I/O, no server imports — so
// scripts/verify-metrics.mjs can exercise everything offline (same
// pattern as lib/lifecycle/core.ts, lib/inventory/lotsCore.ts).
//
// TRUTH RULES (the whole point of this module):
//   · Every number is computed from the rows given — never estimated,
//     never carried over from another block.
//   · Empty input yields EXACT zeros / empty arrays / empty maps —
//     never nulls dressed up as data. Where a quantity cannot be
//     computed (FIFO COGS when sales exceed recorded lots) the block
//     says so explicitly (cogsComplete / cogsErrorAsins) instead of
//     printing a confident wrong number.
//   · A source table that cannot support a figure does not get one:
//     sales_events carries NO refund split (PR-A folds refund fee
//     effects into `fees`), so moneySummary has no refunds field.
//
// WINDOWS: all windows are trailing — [now - days, now] on the row's
// own timestamp, UTC calendar days for the per-day series. Sales with
// sold_at NULL cannot be placed in any window: they are excluded from
// windowed revenue/fees/COGS and counted in `undatedSales` so the
// gap is visible rather than silent.
//
// FIFO COGS (windowed): lots are consumed in true sale order —
// pre-window sales consume the pool first (their COGS belongs to
// earlier windows), then window sales are costed with the EXISTING
// engine (lib/engine/fifo.ts sellUnits), per ASIN, exactly like
// /dashboard/pnl. A sale that exceeds recorded lots flags its ASIN
// in cogsErrorAsins and stops costing that ASIN (pnl-page behavior);
// the revenue/fees of that ASIN still count — only its COGS is
// partial, and cogsComplete says so.

import { groupByAsin, lotCost, sellUnits, type InventoryLot } from "../engine/fifo.ts";
import { summarizePriceHistory, type PricePoint } from "../engine/priceHistory.ts";
import {
  EXCEPTION_STAGES,
  PIPELINE_STAGES,
  type CanonicalStage,
  type OrderJourney,
} from "../lifecycle/core.ts";
import type { SpendCaps } from "../engine/guards.ts";

const DAY_MS = 86_400_000;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function inWindow(iso: string | null, startMs: number, nowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= startMs && t <= nowMs;
}
function utcDayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

// ── Row shapes (plain projections of the tables) ─────────────────────────────

export interface SaleRowLite {
  asin: string;
  qty: number;
  unitPrice: number;
  fees: number;
  soldAt: string | null;
}

export interface PayoutRowLite {
  amount: number;
  currency: string;
  status: string;
  postedAt: string | null;
}

export interface IntentRowLite {
  qty: number;
  unitPrice: number;
  status: string; // PENDING_APPROVAL | APPROVED | EXECUTED | REJECTED
  createdAt: string;
  /** True when this intent is an Alibaba order's linked intent — its
   * money belongs to the alibaba channel, not retail. */
  linkedToAlibaba: boolean;
}

export interface AlibabaSpendRow {
  status: string;
  orderTotal: number;
  createdAt: string;
}

export interface ExternalSpendRow {
  status: string;
  amount: number | null;
  createdAt: string;
}

export interface OfferRowLite {
  supplier: string;
  matchStatus: string; // pending | matched | no_match | error
  pricedAt: string | null;
  evalVerdict: string | null; // candidate | watch | pass | null
}

export interface WatchlistRowLite {
  asin: string;
  active: boolean;
}

export interface CheckRowLite {
  asin: string;
  buyPrice: number;
  sellPrice: number | null;
  verdict: string; // BUY | SKIP | UNKNOWN
  checkedAt: string;
}

export interface ApprovalRowLite {
  status: string; // pending | applied | dismissed
}

export interface ComplianceAlertRowLite {
  kind: string;
  sentAt: string;
}

// ── Money ────────────────────────────────────────────────────────────────────

export interface MoneySummary {
  windowDays: number;
  revenue: number;
  fees: number;
  unitsSold: number;
  salesCount: number;
  cogs: number;
  /** False when at least one ASIN's sales exceed its recorded lots —
   * its COGS (and therefore netProfit) is partial. */
  cogsComplete: boolean;
  cogsErrorAsins: string[];
  netProfit: number;
  marginPct: number;
  payoutsReceived: number;
  payoutsReceivedCount: number;
  /** Payout rows with no posted_at yet (state, not windowed). */
  payoutsUnpostedCount: number;
  /** Distinct payout currencies seen — amounts are summed as-is, so
   * the UI can warn if this ever holds more than one. */
  payoutCurrencies: string[];
  /** Sales rows with sold_at NULL — excluded from every window sum. */
  undatedSales: number;
}

export function moneySummary(
  sales: SaleRowLite[],
  payouts: PayoutRowLite[],
  lots: InventoryLot[],
  windowDays: number,
  nowMs: number = Date.now()
): MoneySummary {
  const startMs = nowMs - windowDays * DAY_MS;
  const dated = sales.filter((s) => s.soldAt && !Number.isNaN(Date.parse(s.soldAt)));
  const undatedSales = sales.length - dated.length;
  const windowSales = dated.filter((s) => inWindow(s.soldAt, startMs, nowMs));
  const preWindowSales = dated.filter((s) => Date.parse(s.soldAt as string) < startMs);

  const revenue = round2(windowSales.reduce((t, s) => t + num(s.qty) * num(s.unitPrice), 0));
  const fees = round2(windowSales.reduce((t, s) => t + num(s.fees), 0));
  const unitsSold = windowSales.reduce((t, s) => t + num(s.qty), 0);

  // FIFO COGS: per ASIN, oldest sale first; pre-window sales consume
  // the pool before window sales are costed (pnl-page semantics).
  let pool: InventoryLot[] = lots.map((l) => ({ ...l }));
  const cogsErrorAsins: string[] = [];
  const costSales = (rows: SaleRowLite[], accumulate: boolean): number => {
    let total = 0;
    const byAsin = new Map<string, SaleRowLite[]>();
    for (const s of rows) {
      const arr = byAsin.get(s.asin) ?? [];
      arr.push(s);
      byAsin.set(s.asin, arr);
    }
    for (const [asin, asinSales] of byAsin) {
      if (cogsErrorAsins.includes(asin)) continue;
      const ordered = [...asinSales].sort(
        (a, b) => Date.parse(a.soldAt as string) - Date.parse(b.soldAt as string)
      );
      for (const sale of ordered) {
        try {
          const res = sellUnits(pool, asin, num(sale.qty));
          pool = res.remainingLots;
          if (accumulate) total += res.cogs;
        } catch {
          cogsErrorAsins.push(asin);
          break;
        }
      }
    }
    return total;
  };
  costSales(preWindowSales, false);
  const cogs = round2(costSales(windowSales, true));

  const netProfit = round2(revenue - fees - cogs);

  const windowPayouts = payouts.filter((p) => inWindow(p.postedAt, startMs, nowMs));
  const payoutsReceived = round2(windowPayouts.reduce((t, p) => t + num(p.amount), 0));
  const payoutCurrencies = [...new Set(payouts.map((p) => p.currency).filter(Boolean))].sort();

  return {
    windowDays,
    revenue,
    fees,
    unitsSold,
    salesCount: windowSales.length,
    cogs,
    cogsComplete: cogsErrorAsins.length === 0,
    cogsErrorAsins,
    netProfit,
    marginPct: revenue > 0 ? round1((netProfit / revenue) * 100) : 0,
    payoutsReceived,
    payoutsReceivedCount: windowPayouts.length,
    payoutsUnpostedCount: payouts.filter((p) => !p.postedAt).length,
    payoutCurrencies,
    undatedSales,
  };
}

// ── Pipeline (order journeys) ────────────────────────────────────────────────

export interface StageBucket {
  stage: CanonicalStage;
  count: number;
  amount: number;
}

export interface PipelineSummary {
  totalJourneys: number;
  byKind: { alibaba: number; retail: number; external: number };
  /** One bucket per canonical stage (pipeline order, then exception
   * states) — journeys counted at their currentStage. */
  stages: StageBucket[];
  /** Mean dwellDays of the journeys currently in the stage (0 when
   * none carry a dwell). */
  avgDwellDaysByStage: Partial<Record<CanonicalStage, number>>;
  exceptionsCount: number;
  staleCount: number;
}

export function pipelineSummary(journeys: OrderJourney[]): PipelineSummary {
  const byKind = { alibaba: 0, retail: 0, external: 0 };
  const buckets = new Map<CanonicalStage, StageBucket>();
  const dwell = new Map<CanonicalStage, { sum: number; n: number }>();
  for (const stage of [...PIPELINE_STAGES, ...EXCEPTION_STAGES]) {
    buckets.set(stage, { stage, count: 0, amount: 0 });
    dwell.set(stage, { sum: 0, n: 0 });
  }
  let exceptionsCount = 0;
  let staleCount = 0;
  for (const j of journeys) {
    byKind[j.kind] += 1;
    const bucket = buckets.get(j.currentStage);
    if (bucket) {
      bucket.count += 1;
      bucket.amount = round2(bucket.amount + num(j.amount));
    }
    if (j.dwellDays !== null && j.dwellDays !== undefined) {
      const d = dwell.get(j.currentStage);
      if (d) {
        d.sum += j.dwellDays;
        d.n += 1;
      }
    }
    if (j.exceptions.length > 0) exceptionsCount += 1;
    if (j.stale) staleCount += 1;
  }
  const avgDwellDaysByStage: Partial<Record<CanonicalStage, number>> = {};
  for (const [stage, d] of dwell) {
    avgDwellDaysByStage[stage] = d.n > 0 ? round1(d.sum / d.n) : 0;
  }
  return {
    totalJourneys: journeys.length,
    byKind,
    stages: [...buckets.values()],
    avgDwellDaysByStage,
    exceptionsCount,
    staleCount,
  };
}

// ── Spend ────────────────────────────────────────────────────────────────────

export interface StatusBucket {
  status: string;
  count: number;
  amount: number;
}

export interface ChannelSpend {
  committed: { count: number; amount: number };
  pending: { count: number; amount: number };
}

export interface SpendSummary {
  intentsByStatus: StatusBucket[];
  alibabaByStatus: StatusBucket[];
  externalByStatus: StatusBucket[];
  channels: {
    retail: ChannelSpend;
    alibaba: ChannelSpend;
    external: ChannelSpend;
  };
  today: {
    /** APPROVED+EXECUTED intents + non-terminal external orders
     * created today (UTC) — money actually committed today. */
    committed: number;
    /** The guard ledger's own usage number for today: Σ qty×price of
     * purchases created today with status ≠ REJECTED (exactly what
     * canCreateIntent compares to the daily cap). */
    guardUsage: number;
    dailyCap: number;
    capRemaining: number;
    capUsedPct: number;
  };
  trailing30d: { committed: number };
  caps: { dailySpendCap: number; perOrderCap: number; maxUnitsPerAsin: number };
}

const INTENT_STATUSES = ["PENDING_APPROVAL", "APPROVED", "EXECUTED", "REJECTED"];
const ALIBABA_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "ready_to_place",
  "awaiting_payment",
  "placed",
  "shipped",
  "delivered",
  "failed",
  "cancelled",
];
const ALIBABA_COMMITTED = new Set([
  "approved",
  "ready_to_place",
  "awaiting_payment",
  "placed",
  "shipped",
  "delivered",
]);
const EXTERNAL_TERMINAL = new Set(["cancelled", "failed", "returned"]);

function bucketize<T>(
  rows: T[],
  statuses: string[],
  statusOf: (r: T) => string,
  amountOf: (r: T) => number
): StatusBucket[] {
  const map = new Map<string, StatusBucket>();
  for (const s of statuses) map.set(s, { status: s, count: 0, amount: 0 });
  for (const r of rows) {
    const status = statusOf(r);
    if (!map.has(status)) map.set(status, { status, count: 0, amount: 0 });
    const b = map.get(status) as StatusBucket;
    b.count += 1;
    b.amount = round2(b.amount + amountOf(r));
  }
  return [...map.values()];
}

export function spendSummary(
  intents: IntentRowLite[],
  alibabaOrders: AlibabaSpendRow[],
  externalOrders: ExternalSpendRow[],
  caps: SpendCaps,
  nowMs: number = Date.now()
): SpendSummary {
  const intentAmount = (i: IntentRowLite) => num(i.qty) * num(i.unitPrice);
  const intentsByStatus = bucketize(intents, INTENT_STATUSES, (i) => i.status, intentAmount);
  const alibabaByStatus = bucketize(
    alibabaOrders,
    ALIBABA_STATUSES,
    (o) => o.status,
    (o) => num(o.orderTotal)
  );
  const externalByStatus = bucketize(
    externalOrders,
    [],
    (o) => o.status,
    (o) => num(o.amount)
  );

  const sumWhere = <T,>(rows: T[], pred: (r: T) => boolean, amountOf: (r: T) => number) => {
    let count = 0;
    let amount = 0;
    for (const r of rows) {
      if (!pred(r)) continue;
      count += 1;
      amount += amountOf(r);
    }
    return { count, amount: round2(amount) };
  };

  const retailIntents = intents.filter((i) => !i.linkedToAlibaba);
  const channels = {
    retail: {
      committed: sumWhere(
        retailIntents,
        (i) => i.status === "APPROVED" || i.status === "EXECUTED",
        intentAmount
      ),
      pending: sumWhere(retailIntents, (i) => i.status === "PENDING_APPROVAL", intentAmount),
    },
    alibaba: {
      committed: sumWhere(alibabaOrders, (o) => ALIBABA_COMMITTED.has(o.status), (o) =>
        num(o.orderTotal)
      ),
      pending: sumWhere(alibabaOrders, (o) => o.status === "pending_approval", (o) =>
        num(o.orderTotal)
      ),
    },
    external: {
      // External orders are placed by the founder directly — there is
      // no approval state, so pending is structurally zero.
      committed: sumWhere(externalOrders, (o) => !EXTERNAL_TERMINAL.has(o.status), (o) =>
        num(o.amount)
      ),
      pending: { count: 0, amount: 0 },
    },
  };

  const todayStartMs = Date.parse(`${utcDayKey(nowMs)}T00:00:00.000Z`);
  const createdToday = (iso: string) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= todayStartMs && t <= nowMs;
  };
  const start30Ms = nowMs - 30 * DAY_MS;

  const committedTodayIntents = intents.filter(
    (i) => (i.status === "APPROVED" || i.status === "EXECUTED") && createdToday(i.createdAt)
  );
  const committedTodayExternal = externalOrders.filter(
    (o) => !EXTERNAL_TERMINAL.has(o.status) && createdToday(o.createdAt)
  );
  const committedToday = round2(
    committedTodayIntents.reduce((t, i) => t + intentAmount(i), 0) +
      committedTodayExternal.reduce((t, o) => t + num(o.amount), 0)
  );
  const guardUsage = round2(
    intents
      .filter((i) => i.status !== "REJECTED" && createdToday(i.createdAt))
      .reduce((t, i) => t + intentAmount(i), 0)
  );
  const committed30 = round2(
    intents
      .filter(
        (i) =>
          (i.status === "APPROVED" || i.status === "EXECUTED") &&
          inWindow(i.createdAt, start30Ms, nowMs)
      )
      .reduce((t, i) => t + intentAmount(i), 0) +
      externalOrders
        .filter((o) => !EXTERNAL_TERMINAL.has(o.status) && inWindow(o.createdAt, start30Ms, nowMs))
        .reduce((t, o) => t + num(o.amount), 0)
  );

  return {
    intentsByStatus,
    alibabaByStatus,
    externalByStatus,
    channels,
    today: {
      committed: committedToday,
      guardUsage,
      dailyCap: caps.dailySpendCap,
      capRemaining: round2(Math.max(0, caps.dailySpendCap - guardUsage)),
      capUsedPct: caps.dailySpendCap > 0 ? round1((guardUsage / caps.dailySpendCap) * 100) : 0,
    },
    trailing30d: { committed: committed30 },
    caps: {
      dailySpendCap: caps.dailySpendCap,
      perOrderCap: caps.perOrderCap,
      maxUnitsPerAsin: caps.maxUnitsPerAsin,
    },
  };
}

// ── Supplier funnel ──────────────────────────────────────────────────────────

export interface SupplierFunnelCounts {
  total: number;
  matched: number;
  pending: number;
  priced: number;
  candidates: number;
}

export interface SupplierFunnel {
  bySupplier: Record<string, SupplierFunnelCounts>;
  combined: SupplierFunnelCounts;
}

/** Definitions identical to GET /api/suppliers' summary: matched =
 * match_status 'matched', pending = 'pending', priced = priced_at set,
 * candidates = eval_verdict 'candidate'. */
export function supplierFunnel(offers: OfferRowLite[]): SupplierFunnel {
  const empty = (): SupplierFunnelCounts => ({
    total: 0,
    matched: 0,
    pending: 0,
    priced: 0,
    candidates: 0,
  });
  const bySupplier: Record<string, SupplierFunnelCounts> = {};
  const combined = empty();
  const bump = (c: SupplierFunnelCounts, o: OfferRowLite) => {
    c.total += 1;
    if (o.matchStatus === "matched") c.matched += 1;
    if (o.matchStatus === "pending") c.pending += 1;
    if (o.pricedAt) c.priced += 1;
    if (o.evalVerdict === "candidate") c.candidates += 1;
  };
  for (const o of offers) {
    if (!bySupplier[o.supplier]) bySupplier[o.supplier] = empty();
    bump(bySupplier[o.supplier], o);
    bump(combined, o);
  }
  return { bySupplier, combined };
}

// ── Discovery (watchlist + deal checks) ──────────────────────────────────────

export interface PriceDrop {
  asin: string;
  currentSell: number | null;
  medianSell: number | null;
  /** (current − median) / median × 100 — negative for a drop. */
  deltaVsMedianPct: number | null;
  checkedPoints: number;
}

export interface DiscoverySummary {
  watchlistSize: number;
  watchlistTotal: number;
  /** Verdict of the LATEST check per ASIN, over the checks provided. */
  verdictMix: { BUY: number; SKIP: number; UNKNOWN: number };
  buyCount: number;
  checksInWindow: number;
  /** ASINs whose trailing-30d price history is a "genuine dip" per
   * lib/engine/priceHistory (≥10% below the window median, ≥3 priced
   * points), biggest drop first, top 10. */
  biggest30dDrops: PriceDrop[];
}

export function discoverySummary(
  watchlist: WatchlistRowLite[],
  checks: CheckRowLite[],
  windowDays: number,
  nowMs: number = Date.now()
): DiscoverySummary {
  const startMs = nowMs - windowDays * DAY_MS;
  const latestByAsin = new Map<string, CheckRowLite>();
  for (const c of checks) {
    const prev = latestByAsin.get(c.asin);
    if (!prev || Date.parse(c.checkedAt) > Date.parse(prev.checkedAt)) {
      latestByAsin.set(c.asin, c);
    }
  }
  const verdictMix = { BUY: 0, SKIP: 0, UNKNOWN: 0 };
  for (const c of latestByAsin.values()) {
    if (c.verdict === "BUY") verdictMix.BUY += 1;
    else if (c.verdict === "SKIP") verdictMix.SKIP += 1;
    else verdictMix.UNKNOWN += 1;
  }

  const start30Ms = nowMs - 30 * DAY_MS;
  const pointsByAsin = new Map<string, PricePoint[]>();
  for (const c of checks) {
    if (!inWindow(c.checkedAt, start30Ms, nowMs)) continue;
    const arr = pointsByAsin.get(c.asin) ?? [];
    arr.push({
      checkedAt: c.checkedAt,
      sellPrice: c.sellPrice ?? 0,
      buyPrice: c.buyPrice,
      verdict: c.verdict,
    });
    pointsByAsin.set(c.asin, arr);
  }
  const drops: PriceDrop[] = [];
  for (const [asin, points] of pointsByAsin) {
    const s = summarizePriceHistory(points);
    if (s.dealQuality !== "genuine dip") continue;
    drops.push({
      asin,
      currentSell: s.currentSell,
      medianSell: s.medianSell,
      deltaVsMedianPct: s.deltaVsMedianPct,
      checkedPoints: s.count,
    });
  }
  drops.sort((a, b) => (a.deltaVsMedianPct ?? 0) - (b.deltaVsMedianPct ?? 0));

  return {
    watchlistSize: watchlist.filter((w) => w.active).length,
    watchlistTotal: watchlist.length,
    verdictMix,
    buyCount: verdictMix.BUY,
    checksInWindow: checks.filter((c) => inWindow(c.checkedAt, startMs, nowMs)).length,
    biggest30dDrops: drops.slice(0, 10),
  };
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryAsinRow {
  asin: string;
  unitsOnHand: number;
  valueAtCost: number;
  avgUnitCost: number;
  oldestUnitAgeDays: number;
  lotCount: number;
}

export interface InventorySummary {
  unitsOnHand: number;
  valueAtCost: number;
  asinCount: number;
  lotCount: number;
  topAsins: InventoryAsinRow[];
}

export function inventorySummary(lots: InventoryLot[], nowMs: number = Date.now()): InventorySummary {
  const groups = groupByAsin(lots, nowMs);
  const rows: InventoryAsinRow[] = groups.map((g) => ({
    asin: g.asin,
    unitsOnHand: g.unitsOnHand,
    valueAtCost: round2(g.lots.reduce((t, l) => t + lotCost(l), 0)),
    avgUnitCost: round2(g.avgUnitCost),
    oldestUnitAgeDays: g.oldestUnitAgeDays,
    lotCount: g.lotCount,
  }));
  return {
    unitsOnHand: rows.reduce((t, r) => t + r.unitsOnHand, 0),
    valueAtCost: round2(rows.reduce((t, r) => t + r.valueAtCost, 0)),
    asinCount: groups.length,
    lotCount: lots.length,
    topAsins: rows
      .filter((r) => r.unitsOnHand > 0)
      .sort((a, b) => b.valueAtCost - a.valueAtCost)
      .slice(0, 5),
  };
}

// ── Alerts / needs attention ─────────────────────────────────────────────────

export interface AlertsSummary {
  /** Brand-approval queue entries awaiting the founder (status pending). */
  pendingApprovals: number;
  appliedApprovals: number;
  /** Purchase intents sitting at PENDING_APPROVAL. */
  pendingIntents: number;
  staleJourneys: number;
  exceptionJourneys: number;
  complianceAlertsInWindow: number;
  complianceAlertsByKind: Array<{ kind: string; count: number }>;
}

export function alertsSummary(input: {
  approvalQueue: ApprovalRowLite[];
  pendingIntentCount: number;
  journeys: OrderJourney[];
  complianceAlerts: ComplianceAlertRowLite[];
  windowDays: number;
  nowMs?: number;
}): AlertsSummary {
  const nowMs = input.nowMs ?? Date.now();
  const startMs = nowMs - input.windowDays * DAY_MS;
  const byKind = new Map<string, number>();
  let inWindowCount = 0;
  for (const a of input.complianceAlerts) {
    if (!inWindow(a.sentAt, startMs, nowMs)) continue;
    inWindowCount += 1;
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  }
  return {
    pendingApprovals: input.approvalQueue.filter((q) => q.status === "pending").length,
    appliedApprovals: input.approvalQueue.filter((q) => q.status === "applied").length,
    pendingIntents: input.pendingIntentCount,
    staleJourneys: input.journeys.filter((j) => j.stale).length,
    exceptionJourneys: input.journeys.filter((j) => j.exceptions.length > 0).length,
    complianceAlertsInWindow: inWindowCount,
    complianceAlertsByKind: [...byKind.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ── Series ───────────────────────────────────────────────────────────────────

export interface DailySalesPoint {
  date: string;
  revenue: number;
  fees: number;
  units: number;
  orders: number;
}

export function dailySeries(
  sales: SaleRowLite[],
  days: number,
  nowMs: number = Date.now()
): DailySalesPoint[] {
  const byDay = new Map<string, DailySalesPoint>();
  const todayKey = utcDayKey(nowMs);
  const startMs = Date.parse(`${todayKey}T00:00:00.000Z`) - (days - 1) * DAY_MS;
  for (let i = 0; i < days; i++) {
    const key = utcDayKey(startMs + i * DAY_MS);
    byDay.set(key, { date: key, revenue: 0, fees: 0, units: 0, orders: 0 });
  }
  for (const s of sales) {
    if (!s.soldAt) continue;
    const t = Date.parse(s.soldAt);
    if (Number.isNaN(t) || t < startMs || t > nowMs) continue;
    const point = byDay.get(utcDayKey(t));
    if (!point) continue;
    point.revenue = round2(point.revenue + num(s.qty) * num(s.unitPrice));
    point.fees = round2(point.fees + num(s.fees));
    point.units += num(s.qty);
    point.orders += 1;
  }
  return [...byDay.values()];
}

export interface PayoutPoint {
  date: string;
  amount: number;
  count: number;
}

/** One point per posted date (ascending); unposted payouts have no
 * date and are excluded — moneySummary counts them separately. */
export function payoutSeries(payouts: PayoutRowLite[]): PayoutPoint[] {
  const byDay = new Map<string, PayoutPoint>();
  for (const p of payouts) {
    if (!p.postedAt) continue;
    const t = Date.parse(p.postedAt);
    if (Number.isNaN(t)) continue;
    const key = utcDayKey(t);
    const point = byDay.get(key) ?? { date: key, amount: 0, count: 0 };
    point.amount = round2(point.amount + num(p.amount));
    point.count += 1;
    byDay.set(key, point);
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface ScanPoint {
  date: string;
  checks: number;
  buys: number;
}

export function scanSeries(
  checks: CheckRowLite[],
  days: number,
  nowMs: number = Date.now()
): ScanPoint[] {
  const byDay = new Map<string, ScanPoint>();
  const todayKey = utcDayKey(nowMs);
  const startMs = Date.parse(`${todayKey}T00:00:00.000Z`) - (days - 1) * DAY_MS;
  for (let i = 0; i < days; i++) {
    const key = utcDayKey(startMs + i * DAY_MS);
    byDay.set(key, { date: key, checks: 0, buys: 0 });
  }
  for (const c of checks) {
    const t = Date.parse(c.checkedAt);
    if (Number.isNaN(t) || t < startMs || t > nowMs) continue;
    const point = byDay.get(utcDayKey(t));
    if (!point) continue;
    point.checks += 1;
    if (c.verdict === "BUY") point.buys += 1;
  }
  return [...byDay.values()];
}
