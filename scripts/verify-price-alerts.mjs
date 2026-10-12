// Offline harness for price-drop alert triggers.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-price-alerts.mjs
// Pure-logic tests — NO network, NO database.
import {
  evaluatePriceAlert,
  BIG_DROP_THRESHOLD_PCT,
  DEDUP_WINDOW_MS,
} from "@/lib/engine/priceAlerts.ts";
import { formatPriceDropAlertMessage } from "@/lib/telegram/alerts.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// Points spaced 1 day apart ending at `endMs` (default: now).
function pts(prices, endMs = Date.now(), dayMs = 24 * 60 * 60 * 1000) {
  return prices.map((p, i) => ({
    checkedAt: new Date(endMs - (prices.length - 1 - i) * dayMs).toISOString(),
    sellPrice: p,
    buyPrice: 0,
    verdict: "SKIP",
  }));
}
const noAlert = { at: null, reason: null };
const hoursAgo = (h, base = Date.now()) => new Date(base - h * 60 * 60 * 1000).toISOString();

// --- trigger (a): new dip ---------------------------------------------------
{
  const d = evaluatePriceAlert({ points: pts([50, 50, 50, 50, 40]), lastAlert: noAlert });
  check("new dip fires on entry into dip territory", d.shouldAlert && d.reason === "new-dip", JSON.stringify(d));
  check("new dip reports current + reference + drop", d.currentPrice === 40 && d.referencePrice === 50 && Math.abs((d.dropPct ?? 0) - 20) < 0.01, JSON.stringify(d));
}

{
  const d = evaluatePriceAlert({
    points: pts([50, 50, 50, 50, 40]),
    lastAlert: { at: hoursAgo(1), reason: "new-dip" },
  });
  check("repeat new-dip within 24h suppressed", !d.shouldAlert && d.reason === null, JSON.stringify(d));
}

{
  // Dip that was already a dip before: no new-dip, and no big-drop either
  // (20% below but not newly crossed).
  const d = evaluatePriceAlert({ points: pts([50, 50, 40, 40]), lastAlert: noAlert });
  check("sustained dip does not re-alert", !d.shouldAlert, JSON.stringify(d));
}

{
  // Dip -> recovery -> dip again, prior alert older than 24h: fires again.
  const d = evaluatePriceAlert({
    points: pts([50, 50, 40, 50, 50, 40]),
    lastAlert: { at: hoursAgo(25), reason: "new-dip" },
  });
  check("new dip fires again after 24h on re-entry", d.shouldAlert && d.reason === "new-dip", JSON.stringify(d));
}

// --- trigger (b): big drop vs 30-day median ----------------------------------
{
  // prev already a dip (12% below) so (a) stays quiet; current crosses 15%.
  const d = evaluatePriceAlert({ points: pts([100, 100, 100, 88, 88, 84]), lastAlert: noAlert });
  check("big drop fires on newly crossing 15%", d.shouldAlert && d.reason === "price-drop-15pct", JSON.stringify(d));
  check("big drop reports 16% vs median 100", d.referencePrice === 100 && Math.abs((d.dropPct ?? 0) - 16) < 0.01, JSON.stringify(d));
}

{
  // Boundary: exactly 15.0% fires.
  const d = evaluatePriceAlert({ points: pts([100, 100, 100, 88, 88, 85]), lastAlert: noAlert });
  check("exactly 15% drop fires", d.shouldAlert && d.reason === "price-drop-15pct", `drop=${d.dropPct}`);
}

{
  // Boundary: 14.9% does not fire.
  const d = evaluatePriceAlert({ points: pts([100, 100, 100, 88, 88, 85.1]), lastAlert: noAlert });
  check("14.9% drop does not fire", !d.shouldAlert, `drop=${d.dropPct} reason=${d.reason}`);
}

{
  // Same big drop but already alerted 1h ago for this trigger: suppressed.
  const d = evaluatePriceAlert({
    points: pts([100, 100, 100, 88, 88, 84]),
    lastAlert: { at: hoursAgo(1), reason: "price-drop-15pct" },
  });
  check("big drop suppressed within 24h for same trigger", !d.shouldAlert, JSON.stringify(d));
}

{
  // Different trigger reason does NOT suppress: new-dip alerted 1h ago, but a
  // fresh 15% crossing still fires.
  const d = evaluatePriceAlert({
    points: pts([100, 100, 100, 88, 88, 84]),
    lastAlert: { at: hoursAgo(1), reason: "new-dip" },
  });
  check("different trigger reason not suppressed", d.shouldAlert && d.reason === "price-drop-15pct", JSON.stringify(d));
}

// --- no-history / insufficient data ------------------------------------------
{
  const d = evaluatePriceAlert({ points: [], lastAlert: noAlert });
  check("no history -> no alert", !d.shouldAlert && d.reason === null);
}

{
  const d = evaluatePriceAlert({ points: pts([50, 40]), lastAlert: noAlert });
  check("fewer than 3 points -> no alert", !d.shouldAlert, JSON.stringify(d));
}

{
  // Latest point unpriced (e.g. UNKNOWN check): no alert.
  const bad = pts([50, 50, 50, 50]);
  bad.push({ checkedAt: new Date().toISOString(), sellPrice: 0, buyPrice: 0, verdict: "UNKNOWN" });
  const d = evaluatePriceAlert({ points: bad, lastAlert: noAlert });
  check("unpriced latest point -> no alert", !d.shouldAlert, JSON.stringify(d));
}

// --- stable prices: nothing fires ---------------------------------------------
{
  const d = evaluatePriceAlert({ points: pts([50, 51, 49, 50, 50]), lastAlert: noAlert });
  check("stable prices -> no alert", !d.shouldAlert && d.reason === null, JSON.stringify(d));
}

// --- constants -----------------------------------------------------------------
{
  check("big-drop threshold is 15", BIG_DROP_THRESHOLD_PCT === 15);
  check("dedup window is 24h", DEDUP_WINDOW_MS === 24 * 60 * 60 * 1000);
}

// --- alert message formatting (pure) -------------------------------------------
{
  const msg = formatPriceDropAlertMessage({
    asin: "B0TEST1234",
    title: "Test Widget <Pro>",
    reason: "new-dip",
    detail: "Price entered genuine-dip territory",
    currentPrice: 18.49,
    referencePrice: 24.99,
    dropPct: 26.0,
  });
  check("message has headline + prices", msg.includes("PRICE DROP") && msg.includes("$24.99") && msg.includes("$18.49"), msg);
  check("message escapes HTML in title", msg.includes("Test Widget &lt;Pro&gt;") && !msg.includes("<Pro>"));
  check("message links the ASIN", msg.includes("https://www.amazon.com/dp/B0TEST1234"));
}

{
  const msg = formatPriceDropAlertMessage({
    asin: "B0TEST1234",
    reason: "price-drop-15pct",
    detail: "dropped",
    currentPrice: 10,
    referencePrice: null,
    dropPct: null,
  });
  check("message handles null reference gracefully", msg.includes("Now $10.00") && msg.includes("Big price drop"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
