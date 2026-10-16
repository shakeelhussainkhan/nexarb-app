import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { capsFromEnv, supabaseIsConfigured } from "@/lib/engine/guards";
import type { InventoryLot } from "@/lib/engine/fifo";
import { assembleJourneys } from "@/lib/lifecycle/assemble";
import type { OrderJourney } from "@/lib/lifecycle/core";
import {
  alertsSummary,
  dailySeries,
  discoverySummary,
  inventorySummary,
  moneySummary,
  payoutSeries,
  pipelineSummary,
  scanSeries,
  spendSummary,
  supplierFunnel,
  type AlibabaSpendRow,
  type ApprovalRowLite,
  type CheckRowLite,
  type ComplianceAlertRowLite,
  type ExternalSpendRow,
  type IntentRowLite,
  type OfferRowLite,
  type PayoutRowLite,
  type SaleRowLite,
  type WatchlistRowLite,
} from "@/lib/dashboard/metricsCore";

// GET /api/dashboard/metrics?days=30
//
// The executive-dashboard metrics API (PR-E1): exact aggregations of
// every module's data — money (revenue/fees/FIFO COGS/payouts),
// order pipeline (canonical lifecycle stages), spend vs caps,
// supplier funnel, discovery, inventory, alerts — plus the daily
// time series PR-E2 charts. All math lives in the pure core
// (lib/dashboard/metricsCore.ts); this route only fetches rows and
// isolates failures.
//
// PARTIAL-FAILURE CONTRACT: each source is fetched independently. A
// source that fails contributes its block computed over zero rows
// (exact zeros / empty arrays, per the core's truth rules) AND an
// entry in `sourceErrors` keyed by source name — the dashboard
// renders partial truth with a visible gap, never a 500 and never
// invented numbers. `sourceErrors` is {} when every source read
// cleanly.
//
// Auth: Clerk session OR personal API key (X-NexArb-Key) via
// resolveUser (proxy.ts bypasses this exact path).
//
// Query: days — window length, default 30, clamped 1–180. Money and
// spend windows are trailing; the pipeline/inventory blocks are
// current-state snapshots (no window applies).

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Route-local: the core's IntentRowLite plus the row id, needed to
 * resolve which intents are Alibaba-linked before aggregation. */
interface IntentWithId extends IntentRowLite {
  id: string;
}

async function attempt<T>(
  sourceErrors: Record<string, string>,
  source: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    sourceErrors[source] = e instanceof Error ? e.message : String(e);
    return fallback;
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json(
      { error: "Supabase is not configured in this environment, so no metrics can be computed." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(180, Math.max(1, Math.trunc(daysRaw))) : 30;

  const admin = getSupabaseAdmin();
  const userId = identity.userId;
  const nowMs = Date.now();
  const sourceErrors: Record<string, string> = {};

  // ── Fetches (each isolated; see the partial-failure contract) ────
  // sales_events is fetched in full: windowed FIFO COGS must consume
  // lots by pre-window sales first (metricsCore semantics).
  const sales = await attempt<SaleRowLite[]>(sourceErrors, "sales_events", async () => {
    const { data, error } = await admin
      .from("sales_events")
      .select("asin, qty, unit_price, fees, sold_at")
      .order("sold_at", { ascending: true, nullsFirst: true })
      .limit(10000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      asin: String(r.asin),
      qty: Number(r.qty) || 0,
      unitPrice: Number(r.unit_price) || 0,
      fees: Number(r.fees) || 0,
      soldAt: r.sold_at ? String(r.sold_at) : null,
    }));
  }, []);

  const payouts = await attempt<PayoutRowLite[]>(sourceErrors, "payouts", async () => {
    const { data, error } = await admin
      .from("payouts")
      .select("amount, currency, status, posted_at")
      .order("posted_at", { ascending: true, nullsFirst: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      amount: Number(r.amount) || 0,
      currency: String(r.currency),
      status: String(r.status),
      postedAt: r.posted_at ? String(r.posted_at) : null,
    }));
  }, []);

  const lots = await attempt<InventoryLot[]>(sourceErrors, "inventory_lots", async () => {
    const { data, error } = await admin.from("inventory_lots").select("*").limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []) as InventoryLot[];
  }, []);

  const intents = await attempt<IntentWithId[]>(sourceErrors, "purchases", async () => {
    const { data, error } = await admin
      .from("purchases")
      .select("id, qty, unit_price, status, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      qty: Number(r.qty) || 0,
      unitPrice: Number(r.unit_price) || 0,
      status: String(r.status),
      createdAt: String(r.created_at),
      linkedToAlibaba: false, // resolved below from alibaba_orders
    }));
  }, []);

  const alibabaSpend = await attempt<AlibabaSpendRow[]>(sourceErrors, "alibaba_orders", async () => {
    const { data, error } = await admin
      .from("alibaba_orders")
      .select("status, order_total, created_at, purchase_intent_id")
      .eq("user_id", userId)
      .limit(2000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    // Mark intents linked to an Alibaba order: their money is the
    // alibaba channel's, not retail's (avoids double counting).
    const linkedIds = new Set(
      rows.map((r) => r.purchase_intent_id).filter((v): v is string => typeof v === "string")
    );
    for (const intent of intents) {
      if (linkedIds.has(intent.id)) intent.linkedToAlibaba = true;
    }
    return rows.map((r) => ({
      status: String(r.status),
      orderTotal: Number(r.order_total) || 0,
      createdAt: String(r.created_at),
    }));
  }, []);

  const externalSpend = await attempt<ExternalSpendRow[]>(sourceErrors, "external_orders", async () => {
    const { data, error } = await admin
      .from("external_orders")
      .select("status, amount, created_at")
      .eq("user_id", userId)
      .limit(1000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      status: String(r.status),
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      createdAt: String(r.created_at),
    }));
  }, []);

  const journeys = await attempt<OrderJourney[]>(sourceErrors, "journeys", async () => {
    return assembleJourneys(
      admin,
      userId,
      sales.map((s) => ({ asin: s.asin, qty: s.qty, sold_at: s.soldAt }))
    );
  }, []);

  const offers = await attempt<OfferRowLite[]>(sourceErrors, "supplier_offers", async () => {
    const { data, error } = await admin
      .from("supplier_offers")
      .select("supplier, match_status, priced_at, eval_verdict")
      .limit(30000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      supplier: String(r.supplier),
      matchStatus: String(r.match_status),
      pricedAt: r.priced_at ? String(r.priced_at) : null,
      evalVerdict: r.eval_verdict ? String(r.eval_verdict) : null,
    }));
  }, []);

  const watchlist = await attempt<WatchlistRowLite[]>(sourceErrors, "watchlist", async () => {
    const { data, error } = await admin.from("watchlist").select("asin, active").limit(5000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      asin: String(r.asin),
      active: Boolean(r.active),
    }));
  }, []);

  // deal_checks: the widest window any block needs is 180 days
  // (scan series at days=180; price drops are defined on 30d).
  const checks = await attempt<CheckRowLite[]>(sourceErrors, "deal_checks", async () => {
    const since = new Date(nowMs - 180 * 86_400_000).toISOString();
    const { data, error } = await admin
      .from("deal_checks")
      .select("asin, buy_price, sell_price, verdict, checked_at")
      .gte("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(30000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      asin: String(r.asin),
      buyPrice: Number(r.buy_price) || 0,
      sellPrice: r.sell_price === null || r.sell_price === undefined ? null : Number(r.sell_price),
      verdict: String(r.verdict),
      checkedAt: String(r.checked_at),
    }));
  }, []);

  const approvalQueue = await attempt<ApprovalRowLite[]>(sourceErrors, "approval_queue", async () => {
    const { data, error } = await admin.from("approval_queue").select("status").limit(5000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ status: String(r.status) }));
  }, []);

  const complianceAlerts = await attempt<ComplianceAlertRowLite[]>(
    sourceErrors,
    "compliance_alerts_log",
    async () => {
      const since = new Date(nowMs - 180 * 86_400_000).toISOString();
      const { data, error } = await admin
        .from("compliance_alerts_log")
        .select("kind, sent_at")
        .eq("user_id", userId)
        .gte("sent_at", since)
        .limit(5000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        kind: String(r.kind),
        sentAt: String(r.sent_at),
      }));
    },
    []
  );

  // ── Aggregation (pure core) ──────────────────────────────────────
  const caps = capsFromEnv(process.env);
  const pendingIntentCount = intents.filter((i) => i.status === "PENDING_APPROVAL").length;

  return NextResponse.json({
    asOf: new Date(nowMs).toISOString(),
    windowDays: days,
    sourceErrors,
    money: moneySummary(sales, payouts, lots, days, nowMs),
    pipeline: pipelineSummary(journeys),
    spend: spendSummary(intents, alibabaSpend, externalSpend, caps, nowMs),
    suppliers: supplierFunnel(offers),
    discovery: discoverySummary(watchlist, checks, days, nowMs),
    inventory: inventorySummary(lots, nowMs),
    alerts: alertsSummary({
      approvalQueue,
      pendingIntentCount,
      journeys,
      complianceAlerts,
      windowDays: days,
      nowMs,
    }),
    series: {
      daily: dailySeries(sales, days, nowMs),
      payouts: payoutSeries(payouts),
      scans: scanSeries(checks, days, nowMs),
    },
  });
}
