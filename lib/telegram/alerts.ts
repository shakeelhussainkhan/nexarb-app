// Telegram BUY-signal alerts (notifications only — never purchases).
// Chat IDs live canonically in nexarb_settings.telegram_chat_id, written by
// POST /api/telegram/connect. The scheduled cron has no userId, so alerts go
// to every connected chat ID, falling back to TELEGRAM_CHAT_ID env when the
// table has none. Never throws: all failures surface as { ok: false, error }.

import type { DealCheckTrace } from "@/lib/engine/dealcheck";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { suggestListPrice } from "@/lib/engine/repricing";

/** A BUY trace plus an optional human-friendly title for the alert header. */
export interface BuyAlertInput extends DealCheckTrace {
  title?: string | null;
}

export interface AlertResult {
  ok: boolean;
  error?: string;
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
  return (
    `🟢 BUY SIGNAL — ${escapeHtml(headline)}\n` +
    `Buy ${money(buy)} → Sell ${money(sell)}\n` +
    `Profit ${money(profit)} (${margin.toFixed(1)}%)\n` +
    pricingLine +
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

/** Send a BUY-signal alert for one trace. Never throws. */
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

    const text = formatBuyAlertMessage(trace);
    const failures: string[] = [];
    let sent = 0;
    for (const chatId of chatIds) {
      const r = await sendToChatId(chatId, text, token);
      if (r.ok) sent++;
      else failures.push(`${chatId}: ${r.error ?? "unknown error"}`);
    }

    if (sent === 0) return { ok: false, error: failures.join("; ") || "send failed" };
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
