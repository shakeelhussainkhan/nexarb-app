// Telegram BUY-signal alerts (notifications only — never purchases).
// Chat IDs live canonically in nexarb_settings.telegram_chat_id, written by
// POST /api/telegram/connect. The scheduled cron has no userId, so alerts go
// to every connected chat ID, falling back to TELEGRAM_CHAT_ID env when the
// table has none. Never throws: all failures surface as { ok: false, error }.

import type { DealCheckTrace } from "@/lib/engine/dealcheck";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { suggestListPrice } from "@/lib/engine/repricing";
import {
  decideBuyAlert,
  eligibilityGateLabel,
  type BuyAlertSnapshot,
} from "@/lib/telegram/buyAlertCore";

/** A BUY trace plus an optional human-friendly title for the alert header. */
export interface BuyAlertInput extends DealCheckTrace {
  title?: string | null;
}

export interface AlertResult {
  ok: boolean;
  error?: string;
  /** BUY alerts only: true when dedupe suppressed a repeat of an unchanged
   * signal. Not an error — the caller counts it separately. */
  suppressed?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Builds the HTML alert body. Pure — safe to test offline. */
export function formatBuyAlertMessage(trace: BuyAlertInput): string {
  const headline = (trace.title ?? "").trim() || trace.asin;
  const buy = trace.inputs.buyPrice.value;
  const sell = trace.verdict.realisticPrice;
  const profit = trace.verdict.netProfitAtRealistic;
  const margin = trace.verdict.marginAtRealistic;
  const pricing = suggestListPrice({
    buyBoxPrice: trace.verdict.realisticPrice || null,
    floorPrice: trace.verdict.floorPrice,
    channel: trace.verdict.chosenChannel ?? "amazon-fba",
  });
  const pricingLine =
    pricing.suggested !== null
      ? `List @ ${money(pricing.suggested)} (floor ${money(pricing.floor)})\n`
      : `Pricing: ${escapeHtml(pricing.reasoning)}\n`;
  // Eligibility gate: a non-SELLABLE deal must never read as a plain BUY.
  // Gated deals get a yellow header naming the gate plus a line with the
  // eligibility state and Amazon's own reason. Clean deals are unchanged.
  const gateLabel = eligibilityGateLabel(trace.eligibility.state);
  const headerLine = gateLabel
    ? `🟡 BUY SIGNAL — ${gateLabel} — ${escapeHtml(headline)}\n`
    : `🟢 BUY SIGNAL — ${escapeHtml(headline)}\n`;
  const gateReason = (trace.eligibility.reasons ?? []).find(
    (r) => typeof r === "string" && r.trim().length > 0
  );
  const gateLine = gateLabel
    ? `Eligibility: ${escapeHtml(trace.eligibility.state)}${gateReason ? ` — ${escapeHtml(gateReason)}` : ""}\n`
    : "";
  return (
    headerLine +
    `Buy ${money(buy)} → Sell ${money(sell)}\n` +
    `Profit ${money(profit)} (${margin.toFixed(1)}%)\n` +
    pricingLine +
    gateLine +
    `ASIN: ${escapeHtml(trace.asin)}\n` +
    `https://www.amazon.com/dp/${trace.asin}`
  );
}

/** Resolve who to alert: all connected chat IDs, or TELEGRAM_CHAT_ID env. Never throws. */
export async function resolveAlertChatIds(
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  try {
    if (supabaseIsConfigured(env)) {
      const { data, error } = await getSupabaseAdmin()
        .from("nexarb_settings")
        .select("telegram_chat_id")
        .not("telegram_chat_id", "is", null);
      if (!error) {
        const ids = (data ?? [])
          .map((r: { telegram_chat_id: string | null }) => r.telegram_chat_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length > 0) return [...new Set(ids)];
      }
    }
  } catch {
    // Fall through to env fallback.
  }
  const fallback = (env.TELEGRAM_CHAT_ID ?? "").trim();
  return fallback ? [fallback] : [];
}

async function sendToChatId(
  chatId: string,
  text: string,
  token: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (data.ok) return { ok: true };
    return { ok: false, error: data.description ?? `Telegram HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** The signal snapshot an alert decision is made against. */
function buyAlertSnapshot(trace: BuyAlertInput): BuyAlertSnapshot {
  return {
    verdict: trace.verdict.state,
    sellPrice: trace.verdict.realisticPrice,
    eligibility: trace.eligibility.state,
  };
}

/** Best-effort read of the last DELIVERED BUY-alert snapshot (migration 026
 * columns on watchlist). Returns null when never alerted AND on any failure
 * (missing migration, DB hiccup) — infra problems degrade to "alert as
 * before", never to suppression. Never throws. */
async function fetchLastBuyAlertState(
  admin: SupabaseAdmin,
  asin: string
): Promise<BuyAlertSnapshot | null> {
  try {
    const { data, error } = await admin
      .from("watchlist")
      .select("last_buy_alert_at, last_buy_alert_verdict, last_buy_alert_sell_price, last_buy_alert_eligibility")
      .eq("asin", asin)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      last_buy_alert_at: string | null;
      last_buy_alert_verdict: string | null;
      last_buy_alert_sell_price: number | string | null;
      last_buy_alert_eligibility: string | null;
    };
    if (!row.last_buy_alert_at || row.last_buy_alert_sell_price === null) return null;
    return {
      verdict: row.last_buy_alert_verdict ?? "BUY",
      sellPrice: Number(row.last_buy_alert_sell_price),
      eligibility: row.last_buy_alert_eligibility ?? "UNKNOWN",
    };
  } catch {
    return null;
  }
}

/** Verdict of the previous persisted deal check for this ASIN (the newest
 * row is the current scan's own check, persisted before alerts are sent).
 * Null when there is no earlier check or the read fails. Never throws. */
async function fetchPreviousCheckVerdict(
  admin: SupabaseAdmin,
  asin: string
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("deal_checks")
      .select("verdict")
      .eq("asin", asin)
      .order("checked_at", { ascending: false })
      .limit(2);
    if (error || !data || data.length < 2) return null;
    const verdict = (data[1] as { verdict: string | null }).verdict;
    return typeof verdict === "string" ? verdict : null;
  } catch {
    return null;
  }
}

/** Record the delivered alert's snapshot so later scans can dedupe against
 * it. Best-effort: errors are swallowed (worst case one repeat alert). */
async function recordBuyAlertState(
  admin: SupabaseAdmin,
  trace: BuyAlertInput
): Promise<void> {
  try {
    await admin
      .from("watchlist")
      .update({
        last_buy_alert_at: new Date().toISOString(),
        last_buy_alert_verdict: trace.verdict.state,
        last_buy_alert_sell_price: trace.verdict.realisticPrice,
        last_buy_alert_eligibility: trace.eligibility.state,
      })
      .eq("asin", trace.asin);
  } catch {
    // Swallowed deliberately — see above.
  }
}

/** Send a BUY-signal alert for one trace. Never throws. Repeat alerts for
 * an unchanged signal are suppressed via the migration 026 dedupe state
 * and surface as { ok: false, suppressed: true }. */
export async function sendBuyAlert(
  trace: BuyAlertInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlertResult> {
  try {
    const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };

    const chatIds = await resolveAlertChatIds(env);
    if (chatIds.length === 0) {
      return { ok: false, error: "No Telegram chat ID configured (connect Telegram first)" };
    }

    // Dedupe gate (best-effort end to end): skip the send when the last
    // delivered alert carried the same verdict, eligibility, and a sell
    // price within the material-move band. State is only recorded AFTER
    // a successful send below, so a failed send never loses an alert.
    let admin: SupabaseAdmin | null = null;
    if (supabaseIsConfigured(env)) {
      admin = getSupabaseAdmin();
      const [lastAlerted, previousVerdict] = await Promise.all([
        fetchLastBuyAlertState(admin, trace.asin),
        fetchPreviousCheckVerdict(admin, trace.asin),
      ]);
      const decision = decideBuyAlert({
        lastAlerted,
        previousVerdict,
        current: buyAlertSnapshot(trace),
      });
      if (!decision.shouldAlert) return { ok: false, suppressed: true };
    }

    const text = formatBuyAlertMessage(trace);
    const failures: string[] = [];
    let sent = 0;
    for (const chatId of chatIds) {
      const r = await sendToChatId(chatId, text, token);
      if (r.ok) sent++;
      else failures.push(`${chatId}: ${r.error ?? "unknown error"}`);
    }

    if (sent === 0) return { ok: false, error: failures.join("; ") || "send failed" };
    // Delivered (fully or partially): advance the dedupe state so the next
    // scan can tell an unchanged repeat from a genuinely changed signal.
    if (admin) await recordBuyAlertState(admin, trace);
    if (failures.length > 0) {
      // Partial success still counts as delivered; surface the failures.
      return { ok: true, error: `partial delivery: ${failures.join("; ")}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "alert failed" };
  }
}

// --- Price-drop alerts -------------------------------------------------------
// Fired by the scan when a watched ASIN's price drops into buy territory or
// drops significantly — even when the scan verdict itself wasn't a BUY.
// Notifications only, never purchases.

export type PriceDropReason = "new-dip" | "price-drop-15pct";

export interface PriceDropAlertInput {
  asin: string;
  title?: string | null;
  reason: PriceDropReason;
  detail: string; // human-readable trigger detail from evaluatePriceAlert
  currentPrice: number;
  referencePrice: number | null;
  dropPct: number | null;
}

const PRICE_DROP_HEADLINE: Record<PriceDropReason, string> = {
  "new-dip": "Genuine dip",
  "price-drop-15pct": "Big price drop",
};

/** Builds the HTML price-drop alert body. Pure — safe to test offline. */
export function formatPriceDropAlertMessage(input: PriceDropAlertInput): string {
  const headline = (input.title ?? "").trim() || input.asin;
  const dropLine =
    input.referencePrice !== null && input.dropPct !== null
      ? `${money(input.referencePrice)} → ${money(input.currentPrice)} (−${input.dropPct.toFixed(1)}%)\n`
      : `Now ${money(input.currentPrice)}\n`;
  return (
    `📉 PRICE DROP — ${escapeHtml(headline)}\n` +
    `${PRICE_DROP_HEADLINE[input.reason]}\n` +
    dropLine +
    `${escapeHtml(input.detail)}\n` +
    `ASIN: ${escapeHtml(input.asin)}\n` +
    `https://www.amazon.com/dp/${input.asin}`
  );
}

/** Send a price-drop alert. Never throws. */
export async function sendPriceDropAlert(
  input: PriceDropAlertInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlertResult> {
  try {
    const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };

    const chatIds = await resolveAlertChatIds(env);
    if (chatIds.length === 0) {
      return { ok: false, error: "No Telegram chat ID configured (connect Telegram first)" };
    }

    const text = formatPriceDropAlertMessage(input);
    const failures: string[] = [];
    let sent = 0;
    for (const chatId of chatIds) {
      const r = await sendToChatId(chatId, text, token);
      if (r.ok) sent++;
      else failures.push(`${chatId}: ${r.error ?? "unknown error"}`);
    }

    if (sent === 0) return { ok: false, error: failures.join("; ") || "send failed" };
    if (failures.length > 0) {
      return { ok: true, error: `partial delivery: ${failures.join("; ")}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "alert failed" };
  }
}

/** Send one import-compliance alert (ISF deadline, document expiry, bond).
 * The text is pre-formatted by lib/compliance/alerts.ts. Never throws. */
export async function sendComplianceAlert(
  text: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlertResult> {
  try {
    const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };

    const chatIds = await resolveAlertChatIds(env);
    if (chatIds.length === 0) {
      return { ok: false, error: "No Telegram chat ID configured (connect Telegram first)" };
    }

    const failures: string[] = [];
    let sent = 0;
    for (const chatId of chatIds) {
      const r = await sendToChatId(chatId, text, token);
      if (r.ok) sent++;
      else failures.push(`${chatId}: ${r.error ?? "unknown error"}`);
    }

    if (sent === 0) return { ok: false, error: failures.join("; ") || "send failed" };
    if (failures.length > 0) {
      return { ok: true, error: `partial delivery: ${failures.join("; ")}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "alert failed" };
  }
}

// --- Approval queue alerts -------------------------------------------------

export interface ApprovalAlertInput {
  asin: string;
  title: string | null;
  channel: string;
  netPerUnit: number;
  marginPct: number;
  buyPrice: number;
  sellPrice: number | null;
  approvalUrl: string;
}

/** Builds the HTML approval-queue alert body. Pure — safe to test offline. */
export function formatApprovalAlertMessage(input: ApprovalAlertInput): string {
  const headline = (input.title ?? "").trim() || input.asin;
  const sellLine =
    input.sellPrice !== null
      ? `Buy ${money(input.buyPrice)} → sell ${money(input.sellPrice)} on ${escapeHtml(input.channel)}\n`
      : `Buy ${money(input.buyPrice)} on ${escapeHtml(input.channel)}\n`;
  return (
    `🔓 PROFITABLE BUT GATED — ${escapeHtml(headline)}\n` +
    `Amazon requires brand approval to list this, and the numbers clear your bar:\n` +
    sellLine +
    `Net ${money(input.netPerUnit)}/unit at ${input.marginPct.toFixed(1)}% margin\n` +
    `ASIN: ${escapeHtml(input.asin)}\n` +
    `Apply for approval: ${escapeHtml(input.approvalUrl)}`
  );
}

/** Send an approval-queue alert. Never throws. */
export async function sendApprovalAlert(
  input: ApprovalAlertInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<AlertResult> {
  try {
    const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };

    const chatIds = await resolveAlertChatIds(env);
    if (chatIds.length === 0) {
      return { ok: false, error: "No Telegram chat ID configured (connect Telegram first)" };
    }

    const text = formatApprovalAlertMessage(input);
    const failures: string[] = [];
    let sent = 0;
    for (const chatId of chatIds) {
      const r = await sendToChatId(chatId, text, token);
      if (r.ok) sent++;
      else failures.push(`${chatId}: ${r.error ?? "unknown error"}`);
    }

    if (sent === 0) return { ok: false, error: failures.join("; ") || "send failed" };
    if (failures.length > 0) {
      return { ok: true, error: `partial delivery: ${failures.join("; ")}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "alert failed" };
  }
}
