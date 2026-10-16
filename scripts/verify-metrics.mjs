// Offline harness for the executive-dashboard metrics core
// (lib/dashboard/metricsCore.ts, PR-E1).
// Run: node scripts/verify-metrics.mjs
// Pure-logic tests — NO network, NO database. Imports the core
// directly (Node strips types); the core's own imports (fifo,
// priceHistory, lifecycle core) are all pure too.
// The central promises under test: exact numbers from the rows
// given, FIFO COGS via the existing engine, and empty input →
// exact zeros (never nulls dressed up as data).
import {
  moneySummary,
  pipelineSummary,
  spendSummary,
  supplierFunnel,
  discoverySummary,
  inventorySummary,
  alertsSummary,
  dailySeries,
  payoutSeries,
  scanSeries,
  round2,
} from "../lib/dashboard/metricsCore.ts";
import { journeyFromAlibabaOrder, journeyFromExternalOrder } from "../lib/lifecycle/core.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = Date.parse("2026-10-15T12:00:00.000Z");

// ── 1. Money: FIFO two-lot sell-through, pre-window consumption ──────────────
const lots = [
  { id: "l1", asin: "A", qty: 10, units_remaining: 10, unit_cost: 2, received_at: "2026-08-01T00:00:00.000Z" },
  { id: "l2", asin: "A", qty: 10, units_remaining: 10, unit_cost: 3, received_at: "2026-08-02T00:00:00.000Z" },
  { id: "l3", asin: "B", qty: 5, units_remaining: 5, unit_cost: 10, received_at: "2026-08-01T00:00:00.000Z" },
];
const sales = [
  // Pre-window (40d before NOW): consumes 4 of lot l1 first.
  { asin: "A", qty: 4, unitPrice: 10, fees: 1, soldAt: "2026-09-05T00:00:00.000Z" },
  // In-window: 8 units = 6 @ $2 (rest of l1) + 2 @ $3 (l2) = $18 COGS.
  { asin: "A", qty: 8, unitPrice: 10, fees: 2, soldAt: "2026-10-10T00:00:00.000Z" },
  { asin: "B", qty: 2, unitPrice: 20, fees: 3, soldAt: "2026-10-11T00:00:00.000Z" },
  // Undated: excluded from every window sum, counted separately.
  { asin: "A", qty: 1, unitPrice: 10, fees: 0, soldAt: null },
];
const payouts = [
  { amount: 55.5, currency: "USD", status: "Posted", postedAt: "2026-10-12T00:00:00.000Z" },
  { amount: 10, currency: "USD", status: "Posted", postedAt: "2026-08-01T00:00:00.000Z" },
  { amount: 5, currency: "USD", status: "Open", postedAt: null },
];
const money = moneySummary(sales, payouts, lots, 30, NOW);
check("money: window revenue counts in-window sales only", money.revenue === 120, `got ${money.revenue}`);
check("money: window fees", money.fees === 5, `got ${money.fees}`);
check("money: units + count", money.unitsSold === 10 && money.salesCount === 2);
check("money: FIFO COGS after pre-window consumption (18 + 20)", money.cogs === 38, `got ${money.cogs}`);
check("money: COGS complete when lots cover sales", money.cogsComplete === true && money.cogsErrorAsins.length === 0);
check("money: net profit = revenue - fees - cogs", money.netProfit === 77, `got ${money.netProfit}`);
check("money: margin pct", money.marginPct === 64.2, `got ${money.marginPct}`);
check("money: payouts received in window only", money.payoutsReceived === 55.5 && money.payoutsReceivedCount === 1);
check("money: unposted payout counted as state", money.payoutsUnpostedCount === 1);
check("money: undated sales surfaced, not silently dropped", money.undatedSales === 1);
check("money: input lots not mutated by FIFO", lots[0].units_remaining === 10);

// ── 2. Money: sales exceeding lots → COGS flagged partial, revenue kept ──────
const short = moneySummary(
  [{ asin: "C", qty: 5, unitPrice: 10, fees: 1, soldAt: "2026-10-10T00:00:00.000Z" }],
  [], [], 30, NOW
);
check("money: uncostable ASIN flagged", short.cogsComplete === false && eq(short.cogsErrorAsins, ["C"]));
check("money: uncosted sale keeps revenue, zero COGS", short.revenue === 50 && short.cogs === 0 && short.netProfit === 49);

// ── 3. Pipeline: paid cubes-like journey + stale draft + external ────────────
const cubesJourney = journeyFromAlibabaOrder(
  {
    id: "o1", ref: "AO-MVA1QI1I-1", title: "Packing cubes", status: "placed",
    targetAsin: "B081NZ4YMH", qty: 350, orderTotal: 1333.11, supplierName: "Naduo",
    screeningVerdict: "clear", createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z", placedAt: "2026-10-14T12:00:00.000Z",
    alibabaStatusRaw: { paySettledManually: true, payEvidence: "Alibaba payment-received email" },
    lastSync: { at: "2026-10-15T10:00:00.000Z", stage: "order_get", ok: false, detail: "e_trade_id missing" },
  },
  null, null, { now: new Date(NOW) }
);
check("pipeline fixture: cubes journey is at paid with the sync exception",
  cubesJourney.currentStage === "paid" && cubesJourney.exceptions.length > 0,
  `${cubesJourney.currentStage} / ${cubesJourney.exceptions.length}`);
const staleJourney = journeyFromAlibabaOrder(
  {
    id: "o2", ref: "AO-OLD", title: "Old draft", status: "draft",
    targetAsin: null, qty: 10, orderTotal: 100, supplierName: null,
    screeningVerdict: "clear", createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z", placedAt: null, alibabaStatusRaw: null, lastSync: null,
  },
  null, null, { now: new Date(NOW) }
);
check("pipeline fixture: 40-day-old draft is stale", staleJourney.stale === true && staleJourney.dwellDays === 40);
const petraJourney = journeyFromExternalOrder(
  {
    id: "e1", userId: "u1", ref: "FS-PETRA-2026-001", supplier: "Petra Industries",
    title: "Petra first order", asin: null, qty: 28, amount: 811.72, currency: "USD",
    status: "placed", milestones: [{ stage: "placed", at: "2026-10-15T16:13:00.000Z", source: "manual" }],
    raw: null, createdAt: "2026-10-15T16:13:00.000Z", updatedAt: "2026-10-15T16:13:00.000Z",
  },
  new Date(NOW)
);
const pipe = pipelineSummary([cubesJourney, staleJourney, petraJourney]);
check("pipeline: totals + kinds", pipe.totalJourneys === 3 && pipe.byKind.alibaba === 2 && pipe.byKind.external === 1 && pipe.byKind.retail === 0);
const bucket = (s) => pipe.stages.find((b) => b.stage === s);
check("pipeline: paid bucket holds the cubes amount", bucket("paid").count === 1 && bucket("paid").amount === 1333.11);
check("pipeline: draft + placed buckets", bucket("draft").count === 1 && bucket("placed").count === 1 && bucket("placed").amount === 811.72);
check("pipeline: untouched stages are exact zeros", bucket("shipped").count === 0 && bucket("shipped").amount === 0 && pipe.stages.length === 15);
check("pipeline: exceptions + stale counts", pipe.exceptionsCount === 1 && pipe.staleCount === 1);
check("pipeline: avg dwell for draft = the stale journey's dwell",
  pipe.avgDwellDaysByStage.draft === staleJourney.dwellDays);

// ── 4. Spend: channels, guard-basis today, caps ──────────────────────────────
const caps = { dailySpendCap: 5000, perOrderCap: 1500, maxUnitsPerAsin: 20 };
const intents = [
  { qty: 350, unitPrice: 3.81, status: "APPROVED", createdAt: "2026-10-15T08:00:00.000Z", linkedToAlibaba: true },
  { qty: 700, unitPrice: 1.86, status: "PENDING_APPROVAL", createdAt: "2026-10-15T09:00:00.000Z", linkedToAlibaba: true },
  { qty: 10, unitPrice: 10, status: "APPROVED", createdAt: "2026-10-01T00:00:00.000Z", linkedToAlibaba: false },
  { qty: 5, unitPrice: 10, status: "REJECTED", createdAt: "2026-10-15T07:00:00.000Z", linkedToAlibaba: false },
  { qty: 2, unitPrice: 25, status: "EXECUTED", createdAt: "2026-09-20T00:00:00.000Z", linkedToAlibaba: false },
];
const aliSpend = [
  { status: "placed", orderTotal: 1333.11, createdAt: "2026-10-14T00:00:00.000Z" },
  { status: "pending_approval", orderTotal: 1301.35, createdAt: "2026-10-15T09:00:00.000Z" },
  { status: "draft", orderTotal: 776.37, createdAt: "2026-10-15T10:00:00.000Z" },
];
const extSpend = [
  { status: "placed", amount: 811.72, createdAt: "2026-10-15T10:00:00.000Z" },
  { status: "cancelled", amount: 50, createdAt: "2026-10-15T10:00:00.000Z" },
];
const spend = spendSummary(intents, aliSpend, extSpend, caps, NOW);
const ibs = (s) => spend.intentsByStatus.find((b) => b.status === s);
check("spend: intents by status", ibs("APPROVED").amount === 1433.5 && ibs("PENDING_APPROVAL").amount === 1302
  && ibs("EXECUTED").amount === 50 && ibs("REJECTED").count === 1);
check("spend: retail channel excludes Alibaba-linked intents",
  spend.channels.retail.committed.amount === 150 && spend.channels.retail.committed.count === 2
  && spend.channels.retail.pending.amount === 0);
check("spend: alibaba channel committed/pending",
  spend.channels.alibaba.committed.amount === 1333.11 && spend.channels.alibaba.pending.amount === 1301.35);
check("spend: external channel excludes terminal rows",
  spend.channels.external.committed.amount === 811.72 && spend.channels.external.pending.amount === 0);
check("spend: committed today = approved intents today + external today",
  spend.today.committed === 2145.22, `got ${spend.today.committed}`);
check("spend: guard usage today counts non-REJECTED created today (guard semantics)",
  spend.today.guardUsage === 2635.5, `got ${spend.today.guardUsage}`);
check("spend: cap math vs guard usage",
  spend.today.dailyCap === 5000 && spend.today.capRemaining === 2364.5 && spend.today.capUsedPct === 52.7);
check("spend: trailing-30d committed", spend.trailing30d.committed === 2295.22, `got ${spend.trailing30d.committed}`);
check("spend: caps echoed", spend.caps.perOrderCap === 1500 && spend.caps.maxUnitsPerAsin === 20);

// ── 5. Supplier funnel (GET /api/suppliers definitions) ─────────────────────
const offers = [
  { supplier: "petra", matchStatus: "matched", pricedAt: "2026-10-14T00:00:00.000Z", evalVerdict: "candidate" },
  { supplier: "petra", matchStatus: "matched", pricedAt: "2026-10-14T00:00:00.000Z", evalVerdict: "watch" },
  { supplier: "petra", matchStatus: "pending", pricedAt: null, evalVerdict: null },
  { supplier: "petra", matchStatus: "no_match", pricedAt: null, evalVerdict: null },
  { supplier: "frontier", matchStatus: "matched", pricedAt: "2026-10-14T00:00:00.000Z", evalVerdict: "candidate" },
  { supplier: "frontier", matchStatus: "pending", pricedAt: null, evalVerdict: null },
];
const funnel = supplierFunnel(offers);
check("funnel: petra counts", eq(funnel.bySupplier.petra, { total: 4, matched: 2, pending: 1, priced: 2, candidates: 1 }));
check("funnel: frontier counts", eq(funnel.bySupplier.frontier, { total: 2, matched: 1, pending: 1, priced: 1, candidates: 1 }));
check("funnel: combined", eq(funnel.combined, { total: 6, matched: 3, pending: 2, priced: 3, candidates: 2 }));

// ── 6. Discovery: verdict mix (latest per ASIN) + genuine-dip drops ──────────
const watchlist = [
  { asin: "A", active: true }, { asin: "B", active: true }, { asin: "C", active: false },
];
const checks = [
  { asin: "A", buyPrice: 40, sellPrice: 100, verdict: "UNKNOWN", checkedAt: "2026-09-20T00:00:00.000Z" },
  { asin: "A", buyPrice: 40, sellPrice: 100, verdict: "UNKNOWN", checkedAt: "2026-10-01T00:00:00.000Z" },
  { asin: "A", buyPrice: 40, sellPrice: 80, verdict: "BUY", checkedAt: "2026-10-14T00:00:00.000Z" },
  { asin: "B", buyPrice: 10, sellPrice: 30, verdict: "BUY", checkedAt: "2026-10-01T00:00:00.000Z" },
  { asin: "B", buyPrice: 10, sellPrice: 30, verdict: "SKIP", checkedAt: "2026-10-10T00:00:00.000Z" },
];
const disc = discoverySummary(watchlist, checks, 30, NOW);
check("discovery: watchlist active/total", disc.watchlistSize === 2 && disc.watchlistTotal === 3);
check("discovery: verdict mix uses the LATEST check per ASIN",
  disc.verdictMix.BUY === 1 && disc.verdictMix.SKIP === 1 && disc.verdictMix.UNKNOWN === 0 && disc.buyCount === 1);
check("discovery: checks in window", disc.checksInWindow === 5);
check("discovery: genuine dip detected vs median (80 vs 100 = -20%)",
  disc.biggest30dDrops.length === 1 && disc.biggest30dDrops[0].asin === "A"
  && disc.biggest30dDrops[0].deltaVsMedianPct === -20 && disc.biggest30dDrops[0].checkedPoints === 3);

// ── 7. Inventory ─────────────────────────────────────────────────────────────
const inv = inventorySummary(lots, NOW);
check("inventory: units + value at cost", inv.unitsOnHand === 25 && inv.valueAtCost === 100);
check("inventory: asin + lot counts", inv.asinCount === 2 && inv.lotCount === 3);
check("inventory: top ASINs carry exact per-ASIN values",
  inv.topAsins.length === 2
  && inv.topAsins.every((r) => r.valueAtCost === 50)
  && inv.topAsins.find((r) => r.asin === "A").avgUnitCost === 2.5);

// ── 8. Alerts ────────────────────────────────────────────────────────────────
const alerts = alertsSummary({
  approvalQueue: [{ status: "pending" }, { status: "pending" }, { status: "applied" }, { status: "dismissed" }],
  pendingIntentCount: 3,
  journeys: [cubesJourney, staleJourney, petraJourney],
  complianceAlerts: [
    { kind: "isf_due", sentAt: "2026-10-10T00:00:00.000Z" },
    { kind: "bond_expiry", sentAt: "2026-10-11T00:00:00.000Z" },
    { kind: "isf_due", sentAt: "2026-06-01T00:00:00.000Z" },
  ],
  windowDays: 30,
  nowMs: NOW,
});
check("alerts: approval queue pending/applied", alerts.pendingApprovals === 2 && alerts.appliedApprovals === 1);
check("alerts: pending intents passthrough", alerts.pendingIntents === 3);
check("alerts: stale + exception journeys", alerts.staleJourneys === 1 && alerts.exceptionJourneys === 1);
check("alerts: compliance alerts in window, by kind",
  alerts.complianceAlertsInWindow === 2
  && alerts.complianceAlertsByKind.length === 2
  && alerts.complianceAlertsByKind.every((k) => k.count === 1));

// ── 9. Series ────────────────────────────────────────────────────────────────
const daily = dailySeries(sales, 30, NOW);
check("series: daily has one point per day, UTC ascending",
  daily.length === 30 && daily[0].date === "2026-09-16" && daily[29].date === "2026-10-15");
const d1010 = daily.find((p) => p.date === "2026-10-10");
const d1011 = daily.find((p) => p.date === "2026-10-11");
check("series: daily revenue/fees/units land on the right days",
  d1010.revenue === 80 && d1010.fees === 2 && d1010.units === 8 && d1010.orders === 1
  && d1011.revenue === 40 && daily.reduce((t, p) => t + p.revenue, 0) === 120);
const pSeries = payoutSeries(payouts);
check("series: payouts aggregated per posted date, unposted excluded",
  eq(pSeries, [
    { date: "2026-08-01", amount: 10, count: 1 },
    { date: "2026-10-12", amount: 55.5, count: 1 },
  ]));
const scans = scanSeries(checks, 30, NOW);
const s1014 = scans.find((p) => p.date === "2026-10-14");
check("series: scans zero-filled with BUYs split out",
  scans.length === 30 && s1014.checks === 1 && s1014.buys === 1
  && scans.reduce((t, p) => t + p.checks, 0) === 5 && scans.reduce((t, p) => t + p.buys, 0) === 2);

// ── 10. Empty everything → exact zeros ───────────────────────────────────────
const em = moneySummary([], [], [], 30, NOW);
check("empty: money is exact zeros",
  em.revenue === 0 && em.fees === 0 && em.cogs === 0 && em.netProfit === 0 && em.marginPct === 0
  && em.payoutsReceived === 0 && em.cogsComplete === true && em.undatedSales === 0);
const ep = pipelineSummary([]);
check("empty: pipeline zeros with all 15 stage buckets",
  ep.totalJourneys === 0 && ep.stages.length === 15 && ep.stages.every((b) => b.count === 0 && b.amount === 0)
  && ep.exceptionsCount === 0 && ep.staleCount === 0);
const es = spendSummary([], [], [], caps, NOW);
check("empty: spend zeros, caps still echoed",
  es.today.committed === 0 && es.today.guardUsage === 0 && es.today.capRemaining === 5000
  && es.trailing30d.committed === 0 && es.intentsByStatus.every((b) => b.count === 0 && b.amount === 0));
check("empty: funnel zeros", supplierFunnel([]).combined.total === 0 && eq(supplierFunnel([]).bySupplier, {}));
const ed = discoverySummary([], [], 30, NOW);
check("empty: discovery zeros", ed.watchlistSize === 0 && ed.buyCount === 0 && ed.biggest30dDrops.length === 0 && ed.checksInWindow === 0);
check("empty: inventory zeros", inventorySummary([], NOW).unitsOnHand === 0 && inventorySummary([], NOW).topAsins.length === 0);
const ea = alertsSummary({ approvalQueue: [], pendingIntentCount: 0, journeys: [], complianceAlerts: [], windowDays: 30, nowMs: NOW });
check("empty: alerts zeros", ea.pendingApprovals === 0 && ea.complianceAlertsInWindow === 0 && ea.complianceAlertsByKind.length === 0);
check("empty: series are zero-filled / empty",
  dailySeries([], 7, NOW).length === 7 && dailySeries([], 7, NOW).every((p) => p.revenue === 0)
  && payoutSeries([]).length === 0 && scanSeries([], 7, NOW).every((p) => p.checks === 0));
check("round2: money rounding is exact", round2(0.1 + 0.2) === 0.3 && round2(1333.11) === 1333.11);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
