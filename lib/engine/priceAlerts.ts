// Price-drop alerts — pure trigger logic.
//
// Complements the BUY-verdict Telegram alerts: fires when a watched ASIN's
// price drops into buy territory (a "genuine dip" per our first-party price
// history) or drops >=15% vs the 30-day median, even when the scan verdict
// itself wasn't a fresh BUY.
//
// Anti-spam: at most one alert per ASIN per 24h per trigger reason. The
// caller persists the last-alert state (watchlist.last_price_alert_at /
// last_price_alert_reason) and passes it back in.
//
// Pure (no network, no secrets) so it can be unit-tested offline.

import {
  summarizePriceHistory,
  type PricePoint,
  type DealQuality,
} from "./priceHistory";

export type PriceAlertReason = "new-dip" | "price-drop-15pct";

export interface LastPriceAlert {
  at: string | null; // ISO timestamp of the last alert, null = never
  reason: string | null; // reason of the last alert, null = never
}

export interface PriceAlertDecision {
  shouldAlert: boolean;
  reason: PriceAlertReason | null;
  detail: string; // human-readable, suitable for the alert body
  currentPrice: number | null;
  referencePrice: number | null; // median the drop is measured against
  dropPct: number | null; // (reference - current) / reference * 100, null when n/a
}

// A drop at least this far below the 30-day median fires the big-drop alert.
export const BIG_DROP_THRESHOLD_PCT = 15;

// Same trigger may not re-fire within this window.
export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// History windows: dip quality is judged on the trailing 90 days (matches the
// deals-page chart default); the big-drop median uses the trailing 30 days.
export const DIP_WINDOW_DAYS = 90;
export const DROP_WINDOW_DAYS = 30;

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function withinDays(points: PricePoint[], nowMs: number, days: number): PricePoint[] {
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  return points.filter((p) => {
    const t = new Date(p.checkedAt).getTime();
    return Number.isFinite(t) && t <= nowMs && t >= cutoff;
  });
}

function dropPctVs(current: number, reference: number): number | null {
  if (!(reference > 0) || !Number.isFinite(current)) return null;
  return ((reference - current) / reference) * 100;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function evaluatePriceAlert(opts: {
  /** Price history for the ASIN, latest check LAST (chronological). */
  points: PricePoint[];
  lastAlert: LastPriceAlert;
  now?: Date | string;
}): PriceAlertDecision {
  const noAlert = (detail: string): PriceAlertDecision => ({
    shouldAlert: false,
    reason: null,
    detail,
    currentPrice: null,
    referencePrice: null,
    dropPct: null,
  });

  const nowMs = opts.now ? new Date(opts.now).getTime() : Date.now();
  if (!Number.isFinite(nowMs)) return noAlert("invalid now timestamp");

  const sorted = [...opts.points].sort(
    (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime()
  );
  const latest = sorted[sorted.length - 1];
  const currentPrice =
    latest && Number.isFinite(latest.sellPrice) && latest.sellPrice > 0
      ? latest.sellPrice
      : null;
  if (currentPrice === null) return noAlert("no current priced point");

  const suppressed = (reason: PriceAlertReason): boolean => {
    if (opts.lastAlert.reason !== reason || !opts.lastAlert.at) return false;
    const at = new Date(opts.lastAlert.at).getTime();
    if (!Number.isFinite(at)) return false;
    return nowMs - at < DEDUP_WINDOW_MS;
  };

  // --- Trigger (a): newly entered "genuine dip" territory -----------------
  // Compare deal quality on the trailing 90-day window with vs without the
  // latest point. A transition from any non-dip state (including
  // "insufficient data" — first time we can tell) into a dip fires.
  const dipWindow = withinDays(sorted, nowMs, DIP_WINDOW_DAYS);
  const prevWindow = dipWindow.slice(0, -1);
  const curQuality: DealQuality = summarizePriceHistory(dipWindow).dealQuality;
  const prevQuality: DealQuality = summarizePriceHistory(prevWindow).dealQuality;
  const dipMedian = summarizePriceHistory(dipWindow).medianSell;

  if (curQuality === "genuine dip" && prevQuality !== "genuine dip") {
    if (suppressed("new-dip")) {
      return noAlert("new-dip suppressed: already alerted within 24h");
    }
    const drop = dipMedian !== null ? dropPctVs(currentPrice, dipMedian) : null;
    return {
      shouldAlert: true,
      reason: "new-dip",
      detail:
        `Price entered genuine-dip territory: now ${money(currentPrice)}` +
        (dipMedian !== null
          ? ` vs 90-day median ${money(dipMedian)}` +
            (drop !== null ? ` (−${drop.toFixed(1)}%)` : "")
          : ""),
      currentPrice,
      referencePrice: dipMedian,
      dropPct: drop,
    };
  }

  // --- Trigger (b): big drop vs the 30-day median ---------------------------
  // Fires when the price newly crosses the 15% line — i.e. the previous point
  // was NOT already >=15% below the median. The reference median is computed
  // from history EXCLUDING the current reading, so a drop is measured against
  // where the price was, not against itself. This keeps a sustained low price
  // from re-pinging every scan; the 24h dedup is a backstop.
  const dropWindow = withinDays(sorted, nowMs, DROP_WINDOW_DAYS).slice(0, -1);
  const windowSells = dropWindow
    .map((p) => p.sellPrice)
    .filter((s) => Number.isFinite(s) && s > 0);
  const median30 = medianOf(windowSells);
  if (median30 !== null && windowSells.length >= 3) {
    const drop = dropPctVs(currentPrice, median30);
    const prevPoint = dropWindow[dropWindow.length - 1];
    const prevDrop =
      prevPoint && Number.isFinite(prevPoint.sellPrice) && prevPoint.sellPrice > 0
        ? dropPctVs(prevPoint.sellPrice, median30)
        : null;
    const newlyCrossed = prevDrop === null || prevDrop < BIG_DROP_THRESHOLD_PCT;
    if (drop !== null && drop >= BIG_DROP_THRESHOLD_PCT && newlyCrossed) {
      if (suppressed("price-drop-15pct")) {
        return noAlert("price-drop-15pct suppressed: already alerted within 24h");
      }
      return {
        shouldAlert: true,
        reason: "price-drop-15pct",
        detail:
          `Price dropped ${drop.toFixed(1)}% vs 30-day median ` +
          `(${money(median30)} → ${money(currentPrice)})`,
        currentPrice,
        referencePrice: median30,
        dropPct: drop,
      };
    }
  }

  return noAlert("no trigger: price not in new-dip or big-drop territory");
}
