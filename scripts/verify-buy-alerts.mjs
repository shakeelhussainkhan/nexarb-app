// Offline harness for Telegram BUY-alert eligibility labels + dedupe.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-buy-alerts.mjs
// Pure-logic tests — NO network, NO database.
// Covers:
//   - formatBuyAlertMessage: APPROVAL_REQUIRED (and any non-SELLABLE state)
//     renders the gated 🟡 header + an Eligibility line naming the gate;
//     a clean SELLABLE deal keeps the exact plain 🟢 layout.
//   - decideBuyAlert (lib/telegram/buyAlertCore.ts): new BUY -> alert;
//     unchanged state+price -> suppress; material price move (>= 5% AND
//     >= $0.50) -> alert; small move -> suppress; eligibility change ->
//     alert; re-entry after a non-BUY check -> alert.
import { formatBuyAlertMessage } from "@/lib/telegram/alerts.ts";
import {
  decideBuyAlert,
  eligibilityGateLabel,
  isGatedEligibility,
  isMaterialPriceMove,
  MATERIAL_PRICE_MOVE_PCT,
  MATERIAL_PRICE_MOVE_MIN_USD,
} from "@/lib/telegram/buyAlertCore.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// --- formatter ---------------------------------------------------------------
function traceWith(eligibility) {
  return {
    asin: "B0DT4W7FP3",
    qty: 10,
    title: "Carter's Baby Clothes Set",
    inputs: {
      buyPrice: { value: 10.0, source: "founder-supplied", note: "" },
      sellPrice: { value: 26.99, source: "sp-api", reason: "", checkedAt: "" },
    },
    eligibility,
    verdict: {
      state: "BUY",
      reasons: [],
      floorPrice: 22.0,
      realisticPrice: 26.99,
      netProfitAtRealistic: 9.5,
      marginAtRealistic: 35.2,
      estMonthlySales: 800,
      velocityConfidence: "medium",
      daysToClear: 4,
      suggestedQty: 10,
    },
    guards: {
      wouldCreateIntent: false,
      reasons: [],
      caps: { dailySpendCap: 2500, perOrderCap: 1000, maxUnitsPerAsin: 20 },
      usage: { spentToday: 0, unitsForAsinToday: 0 },
      killSwitchOn: false,
    },
  };
}

{
  const msg = formatBuyAlertMessage(
    traceWith({
      state: "APPROVAL_REQUIRED",
      reasons: ["You need approval to list this brand."],
      source: "sp-api",
      checkedAt: "",
      approvalLinks: [],
    })
  );
  check(
    "gated header names APPROVAL_REQUIRED gate",
    msg.startsWith("🟡 BUY SIGNAL — APPROVAL REQUIRED (brand-gated) — Carter's Baby Clothes Set"),
    msg.split("\n")[0]
  );
  check("gated alert has no plain green header", !msg.includes("🟢"), msg.split("\n")[0]);
  check(
    "gated alert names the gate reason",
    msg.includes("Eligibility: APPROVAL_REQUIRED — You need approval to list this brand."),
    msg
  );
  check("gated alert keeps economics + link", msg.includes("Buy $10.00 → Sell $26.99") && msg.includes("https://www.amazon.com/dp/B0DT4W7FP3"), msg);
}

{
  const msg = formatBuyAlertMessage(
    traceWith({
      state: "SELLABLE",
      reasons: ["No listing restrictions for this account/ASIN."],
      source: "sp-api",
      checkedAt: "",
      approvalLinks: [],
    })
  );
  check("clean deal keeps plain green header", msg.startsWith("🟢 BUY SIGNAL — Carter's Baby Clothes Set"), msg.split("\n")[0]);
  check("clean deal has no eligibility line", !msg.includes("Eligibility:"), msg);
  check("clean deal has no yellow marker", !msg.includes("🟡"), msg);
}

{
  const blocked = formatBuyAlertMessage(
    traceWith({ state: "BLOCKED", reasons: ["Not eligible to list this ASIN — no application path."], source: "sp-api", checkedAt: "", approvalLinks: [] })
  );
  check("BLOCKED renders gated header", blocked.startsWith("🟡 BUY SIGNAL — BLOCKED — NOT ELIGIBLE TO LIST"), blocked.split("\n")[0]);
  const unknown = formatBuyAlertMessage(
    traceWith({ state: "UNKNOWN", reasons: [], source: "error", checkedAt: "", approvalLinks: [] })
  );
  check("UNKNOWN renders gated header", unknown.startsWith("🟡 BUY SIGNAL — ELIGIBILITY UNCONFIRMED"), unknown.split("\n")[0]);
  check("UNKNOWN without reasons still names the state", unknown.includes("Eligibility: UNKNOWN"), unknown);
}

// --- gate labels ---------------------------------------------------------------
check("SELLABLE is not gated", eligibilityGateLabel("SELLABLE") === null && !isGatedEligibility("SELLABLE"));
check("APPROVAL_REQUIRED label", eligibilityGateLabel("APPROVAL_REQUIRED") === "APPROVAL REQUIRED (brand-gated)");

// --- dedupe predicate ------------------------------------------------------------
const snap = (sellPrice, eligibility = "SELLABLE", verdict = "BUY") => ({ verdict, sellPrice, eligibility });
const decide = (lastAlerted, previousVerdict, current) => decideBuyAlert({ lastAlerted, previousVerdict, current });

{
  const d = decide(null, null, snap(26.99));
  check("never alerted -> alert (new-buy)", d.shouldAlert && d.reason === "new-buy", JSON.stringify(d));
}
{
  const d = decide(snap(26.99), "BUY", snap(26.99));
  check("same state + same price -> suppress", !d.shouldAlert && d.reason === "unchanged", JSON.stringify(d));
}
{
  const d = decide(snap(100), "BUY", snap(106));
  check("price +6% -> alert (price-move)", d.shouldAlert && d.reason === "price-move", JSON.stringify(d));
}
{
  const d = decide(snap(100), "BUY", snap(94));
  check("price -6% -> alert (price-move)", d.shouldAlert && d.reason === "price-move", JSON.stringify(d));
}
{
  const d = decide(snap(100), "BUY", snap(102));
  check("price +2% -> suppress", !d.shouldAlert && d.reason === "unchanged", JSON.stringify(d));
}
{
  const d = decide(snap(5), "BUY", snap(5.3));
  check("price +6% but < $0.50 -> suppress", !d.shouldAlert, JSON.stringify(d));
}
{
  const d = decide(snap(100, "SELLABLE"), "BUY", snap(100, "APPROVAL_REQUIRED"));
  check("eligibility change -> alert", d.shouldAlert && d.reason === "eligibility-change", JSON.stringify(d));
}
{
  const d = decide(snap(26.99, "APPROVAL_REQUIRED"), "SKIP", snap(26.99, "APPROVAL_REQUIRED"));
  check("re-entry after SKIP -> alert (re-entry)", d.shouldAlert && d.reason === "re-entry", JSON.stringify(d));
}
{
  const d = decide(snap(26.99), "BUY", snap(26.99, "SELLABLE", "SKIP"));
  check("non-BUY current -> suppress (not-buy)", !d.shouldAlert && d.reason === "not-buy", JSON.stringify(d));
}

// --- material-move boundaries ------------------------------------------------------
check("thresholds are 5% and $0.50", MATERIAL_PRICE_MOVE_PCT === 5 && MATERIAL_PRICE_MOVE_MIN_USD === 0.5);
check("exactly +5% and >= $0.50 is material", isMaterialPriceMove(100, 105) === true);
check("+4.99% is not material", isMaterialPriceMove(100, 104.99) === false);
check("+$0.49 is not material even at +5%", isMaterialPriceMove(9.8, 10.29) === false);
check("+$0.50 at +5% is material", isMaterialPriceMove(10, 10.5) === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
