// Offline harness for WS2 multi-channel evaluation (Amazon FBA vs Walmart WFS).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-ws2-channels.mjs
import { evaluateChannels } from "../lib/engine/verdict.ts";
import {
  getWalmartSellPrice,
  wfsFeeStack,
  WFS_FULFILLMENT_FEE_ESTIMATE,
} from "../lib/walmart/pricing.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const approx = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

// --- WFS fee stack math -----------------------------------------------------
const fees = wfsFeeStack(50, "beauty");
check("wfs referral pct 15% for beauty", fees.referralPct === 0.15);
check("wfs referral fee math ($50 x 15%)", approx(fees.referralFee, 7.5), `got ${fees.referralFee}`);
check(
  "wfs fulfillment is the documented estimate",
  fees.fulfillmentFee === WFS_FULFILLMENT_FEE_ESTIMATE,
  `got ${fees.fulfillmentFee}`
);
check(
  "wfs total fees math",
  approx(fees.totalFees, 7.5 + WFS_FULFILLMENT_FEE_ESTIMATE),
  `got ${fees.totalFees}`
);
check(
  "wfs assumptions surfaced and label the estimate",
  fees.assumptions.length >= 3 && fees.assumptions.some((a) => /ESTIMATE/i.test(a)),
  JSON.stringify(fees.assumptions)
);
check(
  "wfs default category falls back to 15%",
  wfsFeeStack(100, undefined).referralPct === 0.15
);

// --- Walmart sell-price lookup: honest unavailability -----------------------
const wp = await getWalmartSellPrice("012345678905");
check("walmart price is null (never invented)", wp.price === null);
check("walmart source is unavailable", wp.source === "unavailable", `got ${wp.source}`);
check(
  "walmart reason states the API limitation",
  /does not expose marketplace competitive pricing/i.test(wp.reason),
  wp.reason
);
const wpNoThrow = await getWalmartSellPrice("x", null).then(
  () => true,
  () => false
);
check("walmart lookup never throws", wpNoThrow === true);

// Shared offline deal shape: BSR 5000 beauty -> velocity passes (low confidence),
// so channel choice is driven by price vs fee-stack floor.
const base = {
  buyPrice: 10,
  category: "beauty",
  bsr: 5000,
  qty: 10,
};

// --- amazon-wins -------------------------------------------------------------
const aw = evaluateChannels({
  ...base,
  amazon: { sellPrice: 40, source: "sp-api-pricing" },
  walmart: { sellPrice: 35, source: "unavailable" },
});
const awAmz = aw.channels[0];
const awWmt = aw.channels[1];
check("amazon-wins verdict BUY", aw.verdict === "BUY", `got ${aw.verdict}`);
check("amazon-wins chosenChannel amazon-fba", aw.chosenChannel === "amazon-fba", `got ${aw.chosenChannel}`);
check("amazon-wins two channels evaluated", aw.channels.length === 2);
check(
  "amazon-wins channel order stable",
  awAmz.channel === "amazon-fba" && awWmt.channel === "walmart-wfs"
);
check("amazon channel BUY", awAmz.verdict === "BUY", `got ${awAmz.verdict}`);
check("walmart channel BUY but lower profit", awWmt.verdict === "BUY" && awWmt.netProfit < awAmz.netProfit,
  `wmt=${awWmt.netProfit} amz=${awAmz.netProfit}`);
check("amazon net profit math ($16.35)", approx(awAmz.netProfit, 16.35), `got ${awAmz.netProfit}`);
check("walmart net profit math ($12.20)", approx(awWmt.netProfit, 12.2), `got ${awWmt.netProfit}`);
check(
  "headline fields reflect chosen channel",
  approx(aw.netProfitAtRealistic, awAmz.netProfit) &&
    approx(aw.floorPrice, awAmz.floorPrice) &&
    aw.realisticPrice === awAmz.sellPrice,
  `net=${aw.netProfitAtRealistic} floor=${aw.floorPrice}`
);
check(
  "walmart floor uses WFS fulfillment estimate",
  approx(awWmt.floorPrice, (10 + 1.25 + 0.45 + WFS_FULFILLMENT_FEE_ESTIMATE + 0.35) / 0.65),
  `got ${awWmt.floorPrice}`
);

// --- walmart-wins ------------------------------------------------------------
const ww = evaluateChannels({
  ...base,
  amazon: { sellPrice: 28, source: "sp-api-pricing" },
  // hypothetical future source: exercises the source-agnostic path
  walmart: { sellPrice: 45, source: "walmart-pricing" },
});
const wwWmt = ww.channels[1];
check("walmart-wins verdict BUY", ww.verdict === "BUY", `got ${ww.verdict}`);
check("walmart-wins chosenChannel walmart-wfs", ww.chosenChannel === "walmart-wfs", `got ${ww.chosenChannel}`);
check("walmart net profit math ($20.70)", approx(wwWmt.netProfit, 20.7), `got ${wwWmt.netProfit}`);
check(
  "walmart chosen: headline reflects walmart channel",
  approx(ww.netProfitAtRealistic, wwWmt.netProfit) && ww.realisticPrice === 45
);
check(
  "walmart reasons carry the provenance source",
  wwWmt.sellPriceSource === "walmart-pricing"
);

// --- neither-works -> SKIP ----------------------------------------------------
const sk = evaluateChannels({
  ...base,
  buyPrice: 20,
  amazon: { sellPrice: 30, source: "sp-api-pricing" },
  walmart: { sellPrice: 30, source: "unavailable" },
});
check("neither-works verdict SKIP", sk.verdict === "SKIP", `got ${sk.verdict}`);
check("neither-works chosenChannel null", sk.chosenChannel === null, `got ${sk.chosenChannel}`);
check(
  "neither-works both channels SKIP (below floor)",
  sk.channels.every((c) => c.verdict === "SKIP"),
  sk.channels.map((c) => `${c.channel}:${c.verdict}`).join(",")
);
check(
  "SKIP headline reflects best (lead) channel",
  sk.realisticPrice === 30 && sk.netProfitAtRealistic <= 0,
  `net=${sk.netProfitAtRealistic}`
);

// --- walmart-unavailable -> amazon-only ---------------------------------------
const ao = evaluateChannels({
  ...base,
  amazon: { sellPrice: 40, source: "sp-api-pricing" },
  walmart: {
    sellPrice: null,
    source: "unavailable",
    reason: "Walmart seller API does not expose marketplace competitive pricing",
  },
});
check("amazon-only verdict BUY", ao.verdict === "BUY", `got ${ao.verdict}`);
check("amazon-only chosenChannel amazon-fba", ao.chosenChannel === "amazon-fba", `got ${ao.chosenChannel}`);
check(
  "walmart channel UNKNOWN without price",
  ao.channels[1].verdict === "UNKNOWN" && ao.channels[1].sellPrice === null,
  `got ${ao.channels[1].verdict}`
);
check(
  "walmart channel keeps its source and reason",
  ao.channels[1].sellPriceSource === "unavailable" &&
    /does not expose marketplace competitive pricing/i.test(ao.channels[1].reasons.join(" "))
);

// --- no price data at all -> UNKNOWN ------------------------------------------
const un = evaluateChannels({
  ...base,
  amazon: { sellPrice: null, source: "error", reason: "SP-API not configured" },
  walmart: { sellPrice: null, source: "unavailable", reason: "no competitive endpoint" },
});
check("no-prices verdict UNKNOWN", un.verdict === "UNKNOWN", `got ${un.verdict}`);
check("no-prices chosenChannel null", un.chosenChannel === null, `got ${un.chosenChannel}`);
check(
  "no-prices reasons cite both channels",
  /any channel/i.test(un.reasons.join(" ")) &&
    un.reasons.some((r) => r.startsWith("amazon-fba:")) &&
    un.reasons.some((r) => r.startsWith("walmart-wfs:")),
  JSON.stringify(un.reasons)
);
check(
  "no-prices preserves amazon failure provenance",
  un.reasons.some((r) => /SP-API not configured/.test(r)),
  JSON.stringify(un.reasons)
);

// --- below-floor channel never chosen over a BUY-eligible one ----------------
// Amazon at $20 is below its floor (~$24.48) -> SKIP; Walmart at $45 clears ->
// BUY. The choice must filter by BUY-eligibility first (a SKIP channel must
// never win just because it has a price).
const be = evaluateChannels({
  buyPrice: 10,
  category: "beauty",
  qty: 10,
  amazon: { sellPrice: 20, source: "sp-api-pricing" },
  walmart: { sellPrice: 45, source: "unavailable" },
  velocitySignals: { bsr: 5000, category: "beauty" },
});
check(
  "below-floor SKIP channel not chosen over BUY-eligible channel",
  be.verdict === "BUY" &&
    be.chosenChannel === "walmart-wfs" &&
    be.channels[0].verdict === "SKIP",
  `verdict=${be.verdict} chosen=${be.chosenChannel} amz=${be.channels[0].verdict}`
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
