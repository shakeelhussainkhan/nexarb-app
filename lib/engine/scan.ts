// Shared watchlist-scan core.
// Extracted from POST /api/scan/trigger. Runs every active watchlist item
// through the full deal-check pipeline (live sell price + live eligibility +
// engine verdict + guard dry-run) and persists each trace to deal_checks.
// Never throws per-item: a failing item records an UNKNOWN row and the scan
// continues. Throws only for configuration/input failures (Supabase missing,
// watchlist unreadable) — callers translate those to their response shape.

import { runDealCheck, persistDealCheck, type DealCheckTrace } from "@/lib/engine/dealcheck";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { suggestListPrice, recordPriceMonitor } from "@/lib/engine/repricing";
import { evaluatePriceAlert, type LastPriceAlert } from "@/lib/engine/priceAlerts";
import { evaluateApprovalCandidate, decideQueueAction } from "@/lib/engine/approvalQueueCore";
import {
  fetchWatchlistProductInfo,
  backfillWatchlistProductInfo,
} from "@/lib/engine/productBackfill";
import { sendPriceDropAlert, sendApprovalAlert } from "@/lib/telegram/alerts";

export interface ScanResultItem {
  asin: string;
  verdict: string;
  eligibility: string;
  sellPrice: number | null;
  wouldCreateIntent: boolean;
}

export interface WatchlistScanResult {
  checked: number;
  buys: number;
  results: ScanResultItem[];
  /** Traces that verdict BUY — callers use these for alerts/notifications. */
  buyTraces: DealCheckTrace[];
  /** Price-drop alerts actually delivered during this scan. */
  priceDropAlertsSent: number;
  /** Non-fatal price-drop plumbing errors (never fail the scan). */
  priceDropErrors: string[];
  /** Approval-queue alerts actually delivered during this scan. */
  approvalAlertsSent: number;
  /** Non-fatal approval-queue plumbing errors (never fail the scan). */
  approvalErrors: string[];
}

const DEFAULT_LIMIT = 25;
const DEFAULT_QTY = 10;

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** Best-effort read of the per-ASIN price-alert dedup state. Never throws:
 * a missing migration or DB hiccup degrades to "never alerted". */
async function fetchLastPriceAlert(
  admin: SupabaseAdmin,
  asin: string
): Promise<LastPriceAlert> {
  try {
    const { data, error } = await admin
      .from("watchlist")
      .select("last_price_alert_at, last_price_alert_reason")
      .eq("asin", asin)
      .maybeSingle();
    if (error || !data) return { at: null, reason: null };
    const row = data as { last_price_alert_at: string | null; last_price_alert_reason: string | null };
    return { at: row.last_price_alert_at, reason: row.last_price_alert_reason };
  } catch {
    return { at: null, reason: null };
  }
}

/** Evaluate the price-drop triggers for one ASIN and send the Telegram alert
 * when one fires. Best-effort end to end: returns { sent, error } and never
 * throws, so alert plumbing can never corrupt scan results. */
async function maybeSendPriceDropAlert(
  admin: SupabaseAdmin,
  opts: { asin: string; title: string | null }
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data, error } = await admin
      .from("deal_checks")
      .select("sell_price, checked_at, verdict")
      .eq("asin", opts.asin)
      .order("checked_at", { ascending: true })
      .limit(400);
    if (error) return { sent: false, error: `history read failed for ${opts.asin}: ${error.message}` };

    const points = ((data ?? []) as Array<{
      sell_price: number | string | null;
      checked_at: string;
      verdict: string | null;
    }>).map((r) => ({
      checkedAt: r.checked_at,
      sellPrice: Number(r.sell_price),
      buyPrice: 0,
      verdict: r.verdict ?? "",
    }));

    const nowIso = new Date().toISOString();
    const decision = evaluatePriceAlert({
      points,
      lastAlert: await fetchLastPriceAlert(admin, opts.asin),
      now: nowIso,
    });
    if (!decision.shouldAlert || !decision.reason || decision.currentPrice === null) {
      return { sent: false };
    }

    const sendRes = await sendPriceDropAlert({
      asin: opts.asin,
      title: opts.title,
      reason: decision.reason,
      detail: decision.detail,
      currentPrice: decision.currentPrice,
      referencePrice: decision.referencePrice,
      dropPct: decision.dropPct,
    });
    if (!sendRes.ok) {
      return { sent: false, error: `price-drop alert failed for ${opts.asin}: ${sendRes.error ?? "unknown error"}` };
    }

    // Record the dedup state. Best-effort: a missing migration must not fail
    // the scan, so errors here are swallowed (the 24h dedup simply won't
    // apply until migration 010 is run).
    try {
      await admin
        .from("watchlist")
        .update({ last_price_alert_at: nowIso, last_price_alert_reason: decision.reason })
        .eq("asin", opts.asin);
    } catch {
      // Swallowed deliberately — see above.
    }

    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: `price-drop check failed for ${opts.asin}: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/** Approval queue: when a check is gated (APPROVAL_REQUIRED) but clears the
 * profit bar, queue it for a brand-approval application and alert the
 * founder once, with Amazon's application link. Best-effort end to end:
 * returns { alerted, error } and never throws. A missing migration 013
 * degrades to a collected error — the scan itself is unaffected. */
async function maybeQueueApproval(
  admin: SupabaseAdmin,
  trace: DealCheckTrace,
  opts: { title: string | null }
): Promise<{ alerted: boolean; error?: string }> {
  try {
    const { candidate } = evaluateApprovalCandidate({
      asin: trace.asin,
      eligibilityState: trace.eligibility.state,
      approvalLinks: trace.eligibility.approvalLinks,
      channels: trace.verdict.channels,
      buyPrice: trace.inputs.buyPrice.value,
      sellPrice: trace.inputs.sellPrice.value,
    });
    if (!candidate) return { alerted: false };

    const { data: existingData, error: readError } = await admin
      .from("approval_queue")
      .select("status, alerted_at")
      .eq("asin", trace.asin)
      .maybeSingle();
    if (readError) {
      return { alerted: false, error: `approval queue read failed for ${trace.asin}: ${readError.message}` };
    }
    const existing = existingData
      ? {
          status: (existingData as { status: string }).status as "pending" | "applied" | "dismissed",
          alertedAt: (existingData as { alerted_at: string | null }).alerted_at,
        }
      : null;

    const action = decideQueueAction(existing);
    const nowIso = new Date().toISOString();
    if (action.write === "insert") {
      const { error: insertError } = await admin.from("approval_queue").insert({
        asin: candidate.asin,
        title: opts.title,
        approval_url: candidate.approvalUrl,
        channel: candidate.channel,
        net_per_unit: candidate.netPerUnit,
        margin_pct: candidate.marginPct,
        buy_price: candidate.buyPrice,
        sell_price: candidate.sellPrice,
        status: "pending",
        last_seen_at: nowIso,
      });
      if (insertError) {
        return { alerted: false, error: `approval queue insert failed for ${trace.asin}: ${insertError.message}` };
      }
    } else if (action.write === "refresh") {
      const { error: updateError } = await admin
        .from("approval_queue")
        .update({
          title: opts.title,
          approval_url: candidate.approvalUrl,
          channel: candidate.channel,
          net_per_unit: candidate.netPerUnit,
          margin_pct: candidate.marginPct,
          buy_price: candidate.buyPrice,
          sell_price: candidate.sellPrice,
          last_seen_at: nowIso,
        })
        .eq("asin", trace.asin)
        .eq("status", "pending");
      if (updateError) {
        return { alerted: false, error: `approval queue refresh failed for ${trace.asin}: ${updateError.message}` };
      }
    }

    if (!action.shouldAlert) return { alerted: false };

    const sendRes = await sendApprovalAlert({
      asin: candidate.asin,
      title: opts.title,
      channel: candidate.channel,
      netPerUnit: candidate.netPerUnit,
      marginPct: candidate.marginPct,
      buyPrice: candidate.buyPrice,
      sellPrice: candidate.sellPrice,
      approvalUrl: candidate.approvalUrl,
    });
    if (!sendRes.ok) {
      // Row stays un-alerted; a later scan retries the alert.
      return { alerted: false, error: `approval alert failed for ${trace.asin}: ${sendRes.error ?? "unknown error"}` };
    }
    try {
      await admin.from("approval_queue").update({ alerted_at: nowIso }).eq("asin", trace.asin);
    } catch {
      // Swallowed deliberately — worst case the alert repeats once.
    }
    return { alerted: true };
  } catch (err) {
    return {
      alerted: false,
      error: `approval queue check failed for ${trace.asin}: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export async function runWatchlistScan(
  opts: { limit?: number; userId?: string } = {}
): Promise<WatchlistScanResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  if (!supabaseIsConfigured(process.env)) {
    throw new Error("Supabase is not configured — nowhere to store scan results.");
  }

  const admin = getSupabaseAdmin();
  const { data: items, error } = await admin
    .from("watchlist")
    .select("asin, title, buy_price, category, buy_source")
    .eq("active", true)
    .order("added_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Could not read watchlist: ${error.message}`);
  }

  const list = (items ?? []) as Array<{
    asin: string;
    title: string | null;
    buy_price: number | string;
    category: string | null;
    buy_source: string | null;
  }>;

  const results: ScanResultItem[] = [];
  const buyTraces: DealCheckTrace[] = [];
  const priceDropErrors: string[] = [];
  let priceDropAlertsSent = 0;
  const approvalErrors: string[] = [];
  let approvalAlertsSent = 0;

  for (const item of list) {
    try {
      const trace = await runDealCheck(
        item.asin,
        Number(item.buy_price),
        DEFAULT_QTY,
        item.category ?? undefined,
        item.buy_source ?? undefined
      );
      await persistDealCheck(trace, opts.userId ?? null);
      // Price monitoring (WS4): record the suggested list price vs the
      // observed buy box after every check. Observability only — the
      // auto-reprice stub always skips, so nothing changes a live listing.
      const pricing = suggestListPrice({
        buyBoxPrice: trace.verdict.realisticPrice || null,
        floorPrice: trace.verdict.floorPrice,
        channel: trace.verdict.chosenChannel ?? "amazon-fba",
      });
      await recordPriceMonitor(admin, {
        asin: trace.asin,
        channel: trace.verdict.chosenChannel ?? "amazon-fba",
        ourPrice: pricing.suggested,
        buyBoxPrice: trace.verdict.realisticPrice || null,
      });
      results.push({
        asin: trace.asin,
        verdict: trace.verdict.state,
        eligibility: trace.eligibility.state,
        sellPrice: trace.inputs.sellPrice.value,
        wouldCreateIntent: trace.guards.wouldCreateIntent,
      });
      if (trace.verdict.state === "BUY") buyTraces.push(trace);

      // Product display info backfill (migration 017, own guarded
      // block): a row whose product_title is still NULL gets ONE
      // catalog fetch, persisted for every later read. Once set it is
      // never refetched, so this costs at most one SP-API call per
      // ASIN ever. Display plumbing can never corrupt scan results.
      try {
        const info = await fetchWatchlistProductInfo(admin, item.asin);
        if (info && info.title === null) {
          await backfillWatchlistProductInfo(admin, item.asin);
        }
      } catch {
        // Swallowed deliberately — observability only.
      }

      // Price-drop alerts (own guarded block — alert plumbing can never
      // corrupt the scan results or double-record an item).
      try {
        const priceAlert = await maybeSendPriceDropAlert(admin, {
          asin: trace.asin,
          title: item.title,
        });
        if (priceAlert.sent) priceDropAlertsSent++;
        if (priceAlert.error) priceDropErrors.push(priceAlert.error);
      } catch (err) {
        priceDropErrors.push(
          `price-drop check failed for ${trace.asin}: ${err instanceof Error ? err.message : "unknown"}`
        );
      }

      // Approval queue (own guarded block — same isolation as price-drop).
      try {
        const approval = await maybeQueueApproval(admin, trace, { title: item.title });
        if (approval.alerted) approvalAlertsSent++;
        if (approval.error) approvalErrors.push(approval.error);
      } catch (err) {
        approvalErrors.push(
          `approval queue check failed for ${trace.asin}: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    } catch {
      results.push({
        asin: item.asin,
        verdict: "UNKNOWN",
        eligibility: "UNKNOWN",
        sellPrice: null,
        wouldCreateIntent: false,
      });
    }
  }

  const buys = results.filter((r) => r.verdict === "BUY").length;
  return { checked: results.length, buys, results, buyTraces, priceDropAlertsSent, priceDropErrors, approvalAlertsSent, approvalErrors };
}
