// Offline harness for first-party price-history stats (Keepa-chart replacement).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-price-history.mjs
// Pure-logic tests — NO network, NO database.
import { summarizePriceHistory, DIP_THRESHOLD_PCT, MIN_POINTS } from "@/lib/engine/priceHistory.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
function pts(prices, startDay = 0) {
  return prices.map((p, i) => ({
    checkedAt: new Date(Date.UTC(2026, 8, 1 + startDay + i)).toISOString(),
    sellPrice: p,
    buyPrice: 5,
    verdict: "SKIP",
  }));
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- empty / insufficient -----------------------------------------------
{
  const s = summarizePriceHistory([]);
  check("empty -> insufficient data", s.dealQuality === "insufficient data" && s.count === 0);
}
{
  const s = summarizePriceHistory(pts([10, 11]));
  check("2 points -> insufficient data", s.dealQuality === "insufficient data" && s.count === 2);
}
{
  const s = summarizePriceHistory(pts([10, 11, null, undefined, 0, -3, 12]));
  check("junk prices filtered, 3 valid -> classified", s.count === 3 && s.dealQuality !== "insufficient data");
}

// --- genuine dip ---------------------------------------------------------
{
  // median 20, current 15 => -25% => genuine dip
  const s = summarizePriceHistory(pts([20, 21, 19, 20, 22, 15]));
  check("dip detected", s.dealQuality === "genuine dip", s.dealQuality);
  check("dip delta ≈ -25%", approx(s.deltaVsMedianPct, -25), String(s.deltaVsMedianPct));
  check("dip current = 15", s.currentSell === 15);
}
// --- elevated ------------------------------------------------------------
{
  // median 20, current 24 => +20% => elevated
  const s = summarizePriceHistory(pts([20, 19, 21, 20, 24]));
  check("elevated detected", s.dealQuality === "elevated", s.dealQuality);
  check("elevated delta ≈ +20%", approx(s.deltaVsMedianPct, 20), String(s.deltaVsMedianPct));
}
// --- typical -------------------------------------------------------------
{
  // median 20, current 21 => +5% => typical
  const s = summarizePriceHistory(pts([19, 20, 21, 20, 21]));
  check("typical detected", s.dealQuality === "typical", s.dealQuality);
}
// --- boundary: exactly at threshold --------------------------------------
{
  // median 20, current 18 => -10% => genuine dip (threshold inclusive)
  const s = summarizePriceHistory(pts([20, 20, 20, 18]));
  check("boundary -10% -> genuine dip", s.dealQuality === "genuine dip", `${s.dealQuality} ${s.deltaVsMedianPct}`);
}
{
  // median 20, current 22 => +10% => elevated (threshold inclusive)
  const s = summarizePriceHistory(pts([20, 20, 20, 22]));
  check("boundary +10% -> elevated", s.dealQuality === "elevated", `${s.dealQuality} ${s.deltaVsMedianPct}`);
}
{
  // just inside the band: median 20, current 18.5 => -7.5% => typical
  const s = summarizePriceHistory(pts([20, 20, 20, 18.5]));
  check("inside band -7.5% -> typical", s.dealQuality === "typical", `${s.dealQuality} ${s.deltaVsMedianPct}`);
}

// --- stats ----------------------------------------------------------------
{
  const s = summarizePriceHistory(pts([10, 20, 30]));
  check("min=10", s.minSell === 10);
  check("max=30", s.maxSell === 30);
  check("avg=20", approx(s.avgSell, 20));
  check("median=20", s.medianSell === 20);
  check("current=30 (last point)", s.currentSell === 30);
  check("count=3", s.count === 3);
}
{
  // even-count median: [10,20,30,40] -> 25
  const s = summarizePriceHistory(pts([10, 20, 30, 40]));
  check("even median=25", s.medianSell === 25, String(s.medianSell));
}
// --- unsorted input is sorted defensively ---------------------------------
{
  const s = summarizePriceHistory(pts([30, 10, 20]).reverse());
  check("unsorted: current still = last chronologically", s.currentSell === 20, String(s.currentSell));
  check("unsorted: median=20", s.medianSell === 20);
}
// --- single flat series ----------------------------------------------------
{
  const s = summarizePriceHistory(pts([15, 15, 15, 15]));
  check("flat series -> typical (delta 0)", s.dealQuality === "typical" && approx(s.deltaVsMedianPct, 0));
}
// --- constants sane ---------------------------------------------------------
check("DIP_THRESHOLD_PCT=10", DIP_THRESHOLD_PCT === 10);
check("MIN_POINTS=3", MIN_POINTS === 3);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
