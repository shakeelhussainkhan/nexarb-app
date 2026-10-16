"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  AlertsSummary,
  DailySalesPoint,
  DiscoverySummary,
  InventorySummary,
  MoneySummary,
  PayoutPoint,
  PipelineSummary,
  ScanPoint,
  SpendSummary,
  SupplierFunnel,
} from "@/lib/dashboard/metricsCore";
import type { CanonicalStage } from "@/lib/lifecycle/core";
import AreaChart from "@/components/charts/AreaChart";
import BarChart from "@/components/charts/BarChart";
import Donut from "@/components/charts/Donut";
import Sparkline from "@/components/charts/Sparkline";
import FunnelBars from "@/components/charts/FunnelBars";

// Executive dashboard (PR-E2) — the "world class" home view: an exact
// summary of every data point the platform holds, from ONE source:
// GET /api/dashboard/metrics (PR-E1). HONESTY RULES (founder's
// standing rule): every number below comes from that response — no
// client-side estimates, no demo or placeholder data. A source listed
// in `sourceErrors` renders a visible "source unavailable" note on its
// panel instead of silent numbers; zeros render as zeros; partial
// COGS carries its flag. Panels the API cannot support do not exist
// here (see the PR for the old→new coverage mapping).

interface MetricsResponse {
  asOf: string;
  windowDays: number;
  sourceErrors: Record<string, string>;
  money: MoneySummary;
  pipeline: PipelineSummary;
  spend: SpendSummary;
  suppliers: SupplierFunnel;
  discovery: DiscoverySummary;
  inventory: InventorySummary;
  alerts: AlertsSummary;
  series: { daily: DailySalesPoint[]; payouts: PayoutPoint[]; scans: ScanPoint[] };
}

// Canonical lifecycle vocabulary — mirrors lib/lifecycle/core.ts
// (PIPELINE_STAGES / EXCEPTION_STAGES) and the Orders page's labels.
const PIPELINE_STAGES: CanonicalStage[] = [
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
const EXCEPTION_STAGES: CanonicalStage[] = ["returned", "cancelled", "failed", "problem"];

const STAGE_LABEL: Record<CanonicalStage, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  placed: "Placed",
  paid: "Paid",
  shipped: "Shipped",
  at_warehouse: "At warehouse",
  prepped: "Prepped",
  to_amazon: "To Amazon",
  listed: "Listed",
  selling: "Selling",
  returned: "Returned",
  cancelled: "Cancelled",
  failed: "Failed",
  problem: "Problem",
};

/** Stages that mean an order is placed and moving (not yet selling). */
const IN_FLIGHT_STAGES: CanonicalStage[] = [
  "placed",
  "paid",
  "shipped",
  "at_warehouse",
  "prepped",
  "to_amazon",
  "listed",
];

const NAVY = "#0D1B2A";
const GOLD = "#B8922A";
const GREEN = "#16A34A";
const RED = "#DC2626";

// ── Formatting ─────────────────────────────────────────────────────────

function fmtMoney(n: number, dp: 0 | 2 = 0): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtDay(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : iso;
}

function fmtAsOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Small building blocks ──────────────────────────────────────────────

function sourceNote(errors: Record<string, string>, keys: string[]): string | null {
  const hit = keys.filter((k) => errors[k]);
  return hit.length > 0 ? `Source unavailable (${hit.join(", ")}) — figures are partial.` : null;
}

function Panel({
  title,
  caption,
  note,
  children,
  className = "",
}: {
  title: string;
  caption?: string;
  note?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-white border border-gray-100 px-5 py-5 ${className}`}
      style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          {title}
        </h2>
        {caption && <span className="text-xs text-gray-400">{caption}</span>}
      </div>
      {note && (
        <p className="mb-3 px-3 py-2 rounded-lg text-xs font-medium border" style={{ background: "#FFFBEB", color: "#92400E", borderColor: "#FDE68A" }}>
          ⚠ {note}
        </p>
      )}
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  footnote,
  accent,
  children,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  footnote?: string;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl bg-white px-4 lg:px-5 py-5 border border-gray-100"
      style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}
    >
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <p className="text-xl lg:text-2xl font-semibold" style={{ color: accent ?? NAVY }}>
        {value}
      </p>
      {sub && <div className="text-xs text-gray-400 mt-2">{sub}</div>}
      {children}
      {footnote && <p className="text-[11px] mt-2" style={{ color: "#D97706" }}>{footnote}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const searchParams = useSearchParams();
  const upgraded = searchParams.get("upgraded") === "true";

  const [days, setDays] = useState<30 | 90>(30);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [subscription, setSubscription] = useState<{ plan: string; status: string } | null>(null);
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(upgraded);
  const [freeBannerDismissed, setFreeBannerDismissed] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const fetchMetrics = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/metrics?days=${d}`);
      const body = (await res.json().catch(() => null)) as MetricsResponse | { error?: string } | null;
      if (!res.ok || !body || !("money" in body)) {
        throw new Error(
          body && "error" in body && body.error ? body.error : `Metrics request failed (${res.status})`
        );
      }
      setData(body as MetricsResponse);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      setServerOnline(res.ok);
    } catch {
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics(days);
  }, [days, fetchMetrics]);

  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 60 * 1000);
    fetch("/api/stripe/subscription")
      .then((r) => r.json())
      .then(({ subscription: sub }) => setSubscription(sub ?? { plan: "free", status: "inactive" }))
      .catch(() => {});
    return () => clearInterval(t);
  }, [checkHealth]);

  // "r" refreshes (carried over from the old dashboard).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r") {
        e.preventDefault();
        fetchMetrics(days);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [days, fetchMetrics]);

  async function handleScan() {
    setScanning(true);
    setActionNote("Scan triggered — new deal checks land in a few minutes.");
    try {
      await fetch("/api/scan/trigger", { method: "POST", signal: AbortSignal.timeout(10000) });
    } catch { /* best-effort, same as the old dashboard */ }
    setTimeout(() => {
      fetchMetrics(days);
      setScanning(false);
    }, 5000);
  }

  async function handleDiscover() {
    if (discovering || scanning) return;
    setDiscovering(true);
    try {
      const res = await fetch("/api/sourcing/sweep", { method: "POST", signal: AbortSignal.timeout(10000) });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean; swept?: number; matched?: number; added?: number; error?: string;
      } | null;
      if (res.ok && body?.success) {
        setActionNote(
          `Discovery: ${body.swept ?? 0} swept, ${body.matched ?? 0} matched, ${body.added ?? 0} added to the watchlist.`
        );
      } else {
        setActionNote(body?.error ?? "Discovery failed — try again.");
      }
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "AbortError";
      setActionNote(
        timedOut
          ? "Discovery is still running in the background — figures will update on the next refresh."
          : "Discovery request failed — try again."
      );
    } finally {
      setDiscovering(false);
      fetchMetrics(days);
    }
  }

  const isPaidOrTrialing =
    subscription !== null &&
    (subscription.plan !== "free" || subscription.status === "trialing" || subscription.status === "active");

  // ── Derived figures (all from the API response) ──────────────────────
  const errors = data?.sourceErrors ?? {};
  const inFlight = data
    ? data.pipeline.stages.filter((s) => IN_FLIGHT_STAGES.includes(s.stage))
    : [];
  const inFlightCount = inFlight.reduce((t, s) => t + s.count, 0);
  const inFlightAmount = inFlight.reduce((t, s) => t + s.amount, 0);
  const capPct = data?.spend.today.capUsedPct ?? 0;

  const needsYou: Array<{ label: string; href: string; tone: "amber" | "red" }> = [];
  if (data) {
    const a = data.alerts;
    if (a.exceptionJourneys > 0)
      needsYou.push({ label: `${fmtInt(a.exceptionJourneys)} order${a.exceptionJourneys === 1 ? "" : "s"} with exceptions`, href: "/dashboard/orders", tone: "red" });
    if (a.pendingApprovals > 0)
      needsYou.push({ label: `${fmtInt(a.pendingApprovals)} brand approval${a.pendingApprovals === 1 ? "" : "s"} pending`, href: "/dashboard/approvals", tone: "amber" });
    if (a.pendingIntents > 0)
      needsYou.push({ label: `${fmtInt(a.pendingIntents)} purchase intent${a.pendingIntents === 1 ? "" : "s"} awaiting approval`, href: "/dashboard/purchases", tone: "amber" });
    if (a.staleJourneys > 0)
      needsYou.push({ label: `${fmtInt(a.staleJourneys)} stale order${a.staleJourneys === 1 ? "" : "s"}`, href: "/dashboard/orders", tone: "amber" });
    if (a.complianceAlertsInWindow > 0)
      needsYou.push({ label: `${fmtInt(a.complianceAlertsInWindow)} compliance alert${a.complianceAlertsInWindow === 1 ? "" : "s"} (${data.windowDays}d)`, href: "/dashboard/compliance", tone: "amber" });
  }

  return (
    <div className="p-5 lg:p-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: NAVY }}>
            Business overview
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {data ? (
              <>
                As of <span className="font-medium text-gray-600">{fmtAsOf(data.asOf)}</span> · Money, discovery
                and scans cover the last {data.windowDays} days · Pipeline and inventory are current state
                {loading && <span className="ml-1 text-gray-300">· updating…</span>}
              </>
            ) : (
              "Loading your business metrics…"
            )}
          </p>
          {actionNote && <p className="text-xs mt-1.5 font-medium" style={{ color: GOLD }}>{actionNote}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium">
            <span className={`w-2 h-2 rounded-full ${serverOnline === true ? "bg-green-500 animate-pulse" : serverOnline === false ? "bg-red-500" : "bg-gray-300"}`} />
            <span style={{ color: serverOnline === true ? "#16A34A" : serverOnline === false ? "#EF4444" : "#9CA3AF" }}>
              {serverOnline === true ? "Engine Online" : serverOnline === false ? "Engine Offline" : "Checking…"}
            </span>
          </div>
          <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden" role="group" aria-label="Window">
            {([30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="px-3.5 py-2 text-xs font-semibold transition"
                style={days === d ? { background: NAVY, color: "#fff" } : { color: "#6B7280" }}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchMetrics(days)}
            className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
            title="Refresh data (r)"
          >
            Refresh
          </button>
          <button
            onClick={handleDiscover}
            disabled={discovering || scanning}
            className="px-4 py-2 rounded-xl text-xs font-semibold transition-all border hover:bg-amber-50 disabled:opacity-60"
            style={{ background: "#fff", borderColor: GOLD, color: GOLD }}
            title="Sweep retailer clearance for new deal candidates"
          >
            {discovering ? "Discovering…" : "Discover deals"}
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)" }}
          >
            {scanning ? "Scanning…" : "Run scan now"}
          </button>
        </div>
      </div>

      {/* Upgrade success banner (carried over) */}
      {showUpgradeBanner && (
        <div className="mb-6 px-5 py-4 rounded-2xl flex items-center justify-between" style={{ background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)" }}>
          <div>
            <p className="text-white font-semibold text-sm">🎉 Welcome to NexArb Professional!</p>
            <p className="text-white/80 text-xs mt-0.5">Your 14-day free trial has started.</p>
          </div>
          <button onClick={() => setShowUpgradeBanner(false)} className="text-white/70 hover:text-white transition text-lg">×</button>
        </div>
      )}

      {/* Free-plan prompt (carried over) */}
      {subscription && !isPaidOrTrialing && !showUpgradeBanner && !freeBannerDismissed && (
        <div className="mb-6 px-5 py-3.5 rounded-2xl flex items-center justify-between border" style={{ background: "#FFFBEB", borderColor: "#FDE68A" }}>
          <p className="text-sm font-medium" style={{ color: "#92400E" }}>
            ⚡ You&apos;re on the free plan. Upgrade for full deal volume and automation →
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/dashboard/billing" className="px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ background: GOLD }}>
              Upgrade
            </Link>
            <button onClick={() => setFreeBannerDismissed(true)} className="text-amber-700/60 hover:text-amber-800 transition text-lg px-1">×</button>
          </div>
        </div>
      )}

      {/* Load failure — full error state when nothing has loaded */}
      {loadError && !data && (
        <div className="px-5 py-6 rounded-2xl border text-center" style={{ background: "#FEF2F2", borderColor: "#FECACA" }}>
          <p className="text-sm font-semibold" style={{ color: "#991B1B" }}>Could not load business metrics</p>
          <p className="text-xs mt-1" style={{ color: "#B91C1C" }}>{loadError}</p>
          <button onClick={() => fetchMetrics(days)} className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ background: RED }}>
            Retry
          </button>
        </div>
      )}

      {/* Refresh failure with data on screen */}
      {loadError && data && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm font-medium border" style={{ background: "#FFFBEB", color: "#92400E", borderColor: "#FDE68A" }}>
          ⚠ Refresh failed ({loadError}) — showing the last loaded figures from {fmtAsOf(data.asOf)}.
        </div>
      )}

      {data && (
        <>
          {/* Needs-you strip */}
          <div className="mb-6 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 mr-1">Needs you</span>
            {needsYou.length === 0 ? (
              <span className="text-sm text-gray-400">All clear — nothing needs you right now.</span>
            ) : (
              needsYou.map((n) => (
                <Link
                  key={n.label}
                  href={n.href}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border transition hover:opacity-80"
                  style={
                    n.tone === "red"
                      ? { background: "#FEF2F2", color: "#B91C1C", borderColor: "#FECACA" }
                      : { background: "#FFFBEB", color: "#92400E", borderColor: "#FDE68A" }
                  }
                >
                  {n.tone === "red" ? "⛔" : "⚠"} {n.label} →
                </Link>
              ))
            )}
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label={`Revenue (${data.windowDays}d)`}
              value={fmtMoney(data.money.revenue)}
              sub={<>{fmtInt(data.money.salesCount)} sales · {fmtInt(data.money.unitsSold)} units</>}
              footnote={data.money.undatedSales > 0 ? `${fmtInt(data.money.undatedSales)} sale(s) have no date and are excluded from window totals.` : undefined}
            >
              <div className="mt-3">
                <Sparkline values={data.series.daily.map((p) => p.revenue)} color={GOLD} height={32} ariaLabel="Daily revenue trend" />
              </div>
            </KpiCard>
            <KpiCard label="Amazon fees" value={fmtMoney(data.money.fees)} sub={<>Fees recorded on those sales</>} />
            <KpiCard
              label="COGS (FIFO)"
              value={fmtMoney(data.money.cogs)}
              sub={<>Cost of goods sold, oldest lots first</>}
              footnote={
                !data.money.cogsComplete
                  ? `COGS partial — ${data.money.cogsErrorAsins.length} ASIN(s) sold beyond recorded lots: ${data.money.cogsErrorAsins.slice(0, 3).join(", ")}${data.money.cogsErrorAsins.length > 3 ? "…" : ""}`
                  : undefined
              }
            />
            <KpiCard
              label="Net profit"
              value={fmtMoney(data.money.netProfit)}
              accent={data.money.netProfit < 0 ? RED : NAVY}
              sub={<>Margin <span className="font-semibold" style={{ color: data.money.marginPct >= 0 ? GREEN : RED }}>{data.money.marginPct.toFixed(1)}%</span> on revenue</>}
            />
            <KpiCard
              label="Payouts received"
              value={fmtMoney(data.money.payoutsReceived)}
              sub={<>{fmtInt(data.money.payoutsReceivedCount)} payout(s) posted{data.money.payoutsUnpostedCount > 0 ? ` · ${fmtInt(data.money.payoutsUnpostedCount)} not yet posted` : ""}</>}
              footnote={data.money.payoutCurrencies.length > 1 ? `Multiple payout currencies (${data.money.payoutCurrencies.join(", ")}) — summed as-is.` : undefined}
            />
            <KpiCard
              label="Committed today"
              value={fmtMoney(data.spend.today.committed)}
              sub={
                <>
                  <span className="block mb-1.5">
                    Guard usage {fmtMoney(data.spend.today.guardUsage)} of {fmtMoney(data.spend.today.dailyCap)} daily cap · {fmtMoney(data.spend.today.capRemaining)} left
                  </span>
                  <span className="block h-2 rounded-full bg-gray-100 overflow-hidden">
                    <span
                      className="block h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, capPct))}%`,
                        background: capPct >= 100 ? RED : capPct >= 75 ? "#D97706" : GREEN,
                      }}
                    />
                  </span>
                </>
              }
            />
            <KpiCard
              label="Inventory value at cost"
              value={fmtMoney(data.inventory.valueAtCost)}
              sub={<>{fmtInt(data.inventory.unitsOnHand)} units · {fmtInt(data.inventory.asinCount)} ASINs · {fmtInt(data.inventory.lotCount)} lots</>}
            />
            <KpiCard
              label="Orders in flight"
              value={fmtInt(inFlightCount)}
              sub={<>{fmtMoney(inFlightAmount)} across placed → listed · {fmtInt(data.pipeline.totalJourneys)} journeys tracked</>}
            />
          </div>

          {/* Charts: money trend + payouts */}
          <div className="grid xl:grid-cols-3 gap-4 mb-6">
            <Panel
              title="Revenue vs fees"
              caption={`Daily · last ${data.windowDays} days`}
              note={sourceNote(errors, ["sales_events"])}
              className="xl:col-span-2"
            >
              <AreaChart
                labels={data.series.daily.map((p) => fmtDay(p.date))}
                series={[
                  { label: "Revenue", color: GOLD, values: data.series.daily.map((p) => p.revenue) },
                  { label: "Fees", color: "#64748B", values: data.series.daily.map((p) => p.fees) },
                ]}
                formatValue={(n) => fmtMoney(n)}
                ariaLabel="Daily revenue versus Amazon fees"
              />
            </Panel>
            <Panel title="Payouts by day" caption={`Posted · last ${data.windowDays} days`} note={sourceNote(errors, ["payouts"])}>
              <BarChart
                labels={data.series.payouts
                  .filter((p) => p.date >= payoutCutoffKey(data.asOf, data.windowDays))
                  .map((p) => fmtDay(p.date))}
                series={[
                  {
                    label: "Payouts",
                    color: GREEN,
                    values: data.series.payouts
                      .filter((p) => p.date >= payoutCutoffKey(data.asOf, data.windowDays))
                      .map((p) => p.amount),
                  },
                ]}
                formatValue={(n) => fmtMoney(n)}
                height={220}
                emptyMessage="No payouts posted in window"
                ariaLabel="Payouts posted per day"
              />
            </Panel>
          </div>

          {/* Charts: scan activity */}
          <Panel
            title="Deal checks & BUY verdicts"
            caption={`Daily scan activity · last ${data.windowDays} days`}
            note={sourceNote(errors, ["deal_checks"])}
            className="mb-6"
          >
            <BarChart
              labels={data.series.scans.map((p) => fmtDay(p.date))}
              series={[
                { label: "Checks", color: NAVY, values: data.series.scans.map((p) => p.checks) },
                { label: "BUY verdicts", color: GOLD, values: data.series.scans.map((p) => p.buys) },
              ]}
              formatValue={(n) => fmtInt(n)}
              height={150}
              ariaLabel="Deal checks and BUY verdicts per day"
            />
          </Panel>

          {/* Pipeline + spend */}
          <div className="grid xl:grid-cols-3 gap-4 mb-6">
            <Panel
              title="Order pipeline"
              caption={`${fmtInt(data.pipeline.totalJourneys)} journeys · Alibaba ${fmtInt(data.pipeline.byKind.alibaba)} · Distributor ${fmtInt(data.pipeline.byKind.external)} · Retail ${fmtInt(data.pipeline.byKind.retail)}`}
              note={sourceNote(errors, ["journeys"])}
              className="xl:col-span-2"
            >
              <FunnelBars
                rows={PIPELINE_STAGES.map((stage) => {
                  const b = data.pipeline.stages.find((s) => s.stage === stage);
                  const dwell = data.pipeline.avgDwellDaysByStage[stage];
                  return {
                    label: STAGE_LABEL[stage],
                    count: b?.count ?? 0,
                    amount: b?.amount ?? 0,
                    sub: b && b.count > 0 && dwell ? `avg ${dwell.toFixed(1)}d here` : undefined,
                  };
                })}
                formatAmount={(n) => fmtMoney(n)}
                ariaLabel="Order pipeline by current stage"
              />
              {(data.pipeline.exceptionsCount > 0 || data.pipeline.stages.some((s) => EXCEPTION_STAGES.includes(s.stage) && s.count > 0)) && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: RED }}>
                    Exceptions
                  </p>
                  <FunnelBars
                    rows={EXCEPTION_STAGES.map((stage) => {
                      const b = data.pipeline.stages.find((s) => s.stage === stage);
                      return {
                        label: STAGE_LABEL[stage],
                        count: b?.count ?? 0,
                        amount: b?.amount ?? 0,
                        tone: "danger" as const,
                      };
                    })}
                    formatAmount={(n) => fmtMoney(n)}
                    ariaLabel="Orders in exception stages"
                  />
                  <p className="text-xs text-gray-400 mt-3">
                    {fmtInt(data.pipeline.exceptionsCount)} journey(s) carry exceptions · {fmtInt(data.pipeline.staleCount)} stale
                  </p>
                </div>
              )}
              <Link href="/dashboard/orders" className="inline-block mt-4 text-xs font-semibold" style={{ color: GOLD }}>
                Open the Orders board →
              </Link>
            </Panel>

            <Panel
              title="Spend by channel"
              caption="Committed · current state"
              note={sourceNote(errors, ["purchases", "alibaba_orders", "external_orders"])}
            >
              <Donut
                slices={[
                  { label: "Retail", value: data.spend.channels.retail.committed.amount, color: "#0288D1" },
                  { label: "Alibaba", value: data.spend.channels.alibaba.committed.amount, color: "#C62828" },
                  { label: "Distributor", value: data.spend.channels.external.committed.amount, color: GOLD },
                ]}
                centerValue={fmtMoney(
                  data.spend.channels.retail.committed.amount +
                    data.spend.channels.alibaba.committed.amount +
                    data.spend.channels.external.committed.amount
                )}
                centerLabel="committed"
                formatValue={(n) => fmtMoney(n)}
                ariaLabel="Committed spend by channel"
              />
              <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs text-gray-500">
                {(
                  [
                    ["Retail", data.spend.channels.retail],
                    ["Alibaba", data.spend.channels.alibaba],
                    ["Distributor", data.spend.channels.external],
                  ] as const
                ).map(([label, ch]) => (
                  <p key={label} className="flex justify-between">
                    <span>{label} pending</span>
                    <span className="font-medium" style={{ color: NAVY }}>
                      {fmtInt(ch.pending.count)} · {fmtMoney(ch.pending.amount)}
                    </span>
                  </p>
                ))}
                <p className="flex justify-between pt-1.5 border-t border-gray-50">
                  <span>Committed (30d)</span>
                  <span className="font-medium" style={{ color: NAVY }}>{fmtMoney(data.spend.trailing30d.committed)}</span>
                </p>
                <p className="flex justify-between">
                  <span>Caps</span>
                  <span className="font-medium" style={{ color: NAVY }}>
                    {fmtMoney(data.spend.caps.perOrderCap)}/order · {fmtInt(data.spend.caps.maxUnitsPerAsin)} units/ASIN/day
                  </span>
                </p>
              </div>
            </Panel>
          </div>

          {/* Suppliers + discovery + inventory */}
          <div className="grid xl:grid-cols-3 gap-4">
            <Panel title="Supplier catalogs" caption="Offers funnel by supplier" note={sourceNote(errors, ["supplier_offers"])}>
              {Object.keys(data.suppliers.bySupplier).length === 0 ? (
                <p className="text-sm text-gray-400">No supplier offers ingested yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-semibold">Supplier</th>
                      <th className="pb-2 font-semibold text-right">Offers</th>
                      <th className="pb-2 font-semibold text-right">Matched</th>
                      <th className="pb-2 font-semibold text-right">Priced</th>
                      <th className="pb-2 font-semibold text-right">Candidates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.suppliers.bySupplier)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([key, c]) => (
                        <tr key={key} className="border-b border-gray-50">
                          <td className="py-2 font-medium" style={{ color: NAVY }}>{supplierName(key)}</td>
                          <td className="py-2 text-right text-gray-600">{fmtInt(c.total)}</td>
                          <td className="py-2 text-right text-gray-600">{fmtInt(c.matched)}</td>
                          <td className="py-2 text-right text-gray-600">{fmtInt(c.priced)}</td>
                          <td className="py-2 text-right font-semibold" style={{ color: c.candidates > 0 ? GREEN : NAVY }}>{fmtInt(c.candidates)}</td>
                        </tr>
                      ))}
                    <tr>
                      <td className="py-2 font-semibold" style={{ color: NAVY }}>Combined</td>
                      <td className="py-2 text-right font-semibold" style={{ color: NAVY }}>{fmtInt(data.suppliers.combined.total)}</td>
                      <td className="py-2 text-right font-semibold" style={{ color: NAVY }}>{fmtInt(data.suppliers.combined.matched)}</td>
                      <td className="py-2 text-right font-semibold" style={{ color: NAVY }}>{fmtInt(data.suppliers.combined.priced)}</td>
                      <td className="py-2 text-right font-semibold" style={{ color: NAVY }}>{fmtInt(data.suppliers.combined.candidates)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              <Link href="/dashboard/suppliers" className="inline-block mt-3 text-xs font-semibold" style={{ color: GOLD }}>
                Open Suppliers →
              </Link>
            </Panel>

            <Panel
              title="Discovery"
              caption={`Watchlist ${fmtInt(data.discovery.watchlistSize)} active ASINs · ${fmtInt(data.discovery.checksInWindow)} checks (${data.windowDays}d)`}
              note={sourceNote(errors, ["watchlist", "deal_checks"])}
            >
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#F0FDF4", color: "#15803D" }}>
                  BUY {fmtInt(data.discovery.verdictMix.BUY)}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#F9FAFB", color: "#6B7280" }}>
                  SKIP {fmtInt(data.discovery.verdictMix.SKIP)}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#FFFBEB", color: "#B45309" }}>
                  UNKNOWN {fmtInt(data.discovery.verdictMix.UNKNOWN)}
                </span>
                <span className="text-[11px] text-gray-400">latest verdict per ASIN</span>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Biggest 30-day price drops</p>
              {data.discovery.biggest30dDrops.length === 0 ? (
                <p className="text-sm text-gray-400">No genuine dips in the last 30 days.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.discovery.biggest30dDrops.map((d) => (
                    <li key={d.asin} className="py-2 flex items-baseline justify-between gap-3">
                      <Link href={`/dashboard/deals/${d.asin}`} className="text-sm font-medium hover:underline truncate" style={{ color: NAVY }}>
                        {d.asin}
                      </Link>
                      <span className="text-right whitespace-nowrap">
                        <span className="text-sm font-semibold" style={{ color: GREEN }}>
                          {d.deltaVsMedianPct !== null ? `${Math.abs(d.deltaVsMedianPct).toFixed(1)}% below median` : "—"}
                        </span>
                        <span className="block text-[11px] text-gray-400">
                          {d.currentSell !== null ? fmtMoney(d.currentSell, 2) : "—"} vs {d.medianSell !== null ? fmtMoney(d.medianSell, 2) : "—"} median · {fmtInt(d.checkedPoints)} points
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/dashboard/deals" className="inline-block mt-3 text-xs font-semibold" style={{ color: GOLD }}>
                Open Deals →
              </Link>
            </Panel>

            <Panel title="Inventory" caption="On hand · current state" note={sourceNote(errors, ["inventory_lots"])}>
              <p className="text-sm text-gray-500 mb-3">
                <span className="font-semibold" style={{ color: NAVY }}>{fmtInt(data.inventory.unitsOnHand)}</span> units ·{" "}
                <span className="font-semibold" style={{ color: NAVY }}>{fmtMoney(data.inventory.valueAtCost)}</span> at cost ·{" "}
                {fmtInt(data.inventory.asinCount)} ASINs · {fmtInt(data.inventory.lotCount)} lots
              </p>
              {data.inventory.topAsins.length === 0 ? (
                <p className="text-sm text-gray-400">No inventory on hand yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-semibold">ASIN</th>
                      <th className="pb-2 font-semibold text-right">Units</th>
                      <th className="pb-2 font-semibold text-right">Avg cost</th>
                      <th className="pb-2 font-semibold text-right">Value</th>
                      <th className="pb-2 font-semibold text-right">Oldest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inventory.topAsins.map((r) => (
                      <tr key={r.asin} className="border-b border-gray-50">
                        <td className="py-2 font-medium truncate max-w-28" style={{ color: NAVY }} title={r.asin}>{r.asin}</td>
                        <td className="py-2 text-right text-gray-600">{fmtInt(r.unitsOnHand)}</td>
                        <td className="py-2 text-right text-gray-600">{fmtMoney(r.avgUnitCost, 2)}</td>
                        <td className="py-2 text-right font-semibold" style={{ color: NAVY }}>{fmtMoney(r.valueAtCost)}</td>
                        <td className="py-2 text-right text-gray-600">{fmtInt(r.oldestUnitAgeDays)}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link href="/dashboard/inventory" className="inline-block mt-3 text-xs font-semibold" style={{ color: GOLD }}>
                Open Inventory →
              </Link>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/** First day (UTC, YYYY-MM-DD) of the trailing window ending at asOf. */
function payoutCutoffKey(asOfIso: string, windowDays: number): string {
  const t = Date.parse(asOfIso);
  if (Number.isNaN(t)) return "";
  return new Date(t - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
}

const SUPPLIER_NAMES: Record<string, string> = {
  petra: "Petra Industries",
  frontier: "Frontier Co-op",
};

function supplierName(key: string): string {
  return SUPPLIER_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
