// Offline harness for the shared deal-check pipeline.
// Run: node scripts/verify-dealcheck.mjs
import { runDealCheck } from "../lib/engine/dealcheck.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// No SP-API config in env here -> sell price unavailable, eligibility UNKNOWN.
const trace = await runDealCheck("B004IR3044", 5.97, 10, undefined, {});
check("trace has asin/qty", trace.asin === "B004IR3044" && trace.qty === 10);
check(
  "no SP-API -> sell price null with reason",
  trace.inputs.sellPrice.value === null && /not configured/i.test(trace.inputs.sellPrice.reason)
);
check("verdict UNKNOWN without sell price", trace.verdict.state === "UNKNOWN");
check("guards refuse intent", trace.guards.wouldCreateIntent === false);
check(
  "caps surfaced",
  trace.guards.caps.dailySpendCap === 500 && trace.guards.caps.perOrderCap === 250
);
check("kill switch off", trace.guards.killSwitchOn === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
