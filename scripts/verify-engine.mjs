// Offline harness for the decision engine. Run: node scripts/verify-engine.mjs
// (Node >= 23 strips the TS types in lib/engine/*.ts automatically.)
import { floorPrice, outcomeAtPrice } from "../lib/engine/pricing.ts";
import { estimateVelocity, daysToClear } from "../lib/engine/velocity.ts";
import { evaluateDeal } from "../lib/engine/verdict.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. Research worked example: $8 source, $0.75 prep, $0.45 inbound, $3.55 FBA,
//    $0.35 storage, 15% referral, 20% target margin -> floor $20.15.
const floor = floorPrice(
  { buyCost: 8, prepPerUnit: 0.75, inboundPerUnit: 0.45, fbaFee: 3.55, storagePerUnit: 0.35, referralPct: 0.15 },
  0.2
);
check("floor matches research worked example ($20.15)", near(floor, 20.15, 0.01), `got ${floor}`);

// 2. At the $22 Buy Box the same item nets ~$1.20/unit after referral+costs.
const out = outcomeAtPrice(22, { buyCost: 8, prepPerUnit: 0.75, inboundPerUnit: 0.45, fbaFee: 3.55, storagePerUnit: 0.35, referralPct: 0.15 });
check("net at $22 realistic", near(out.netProfit, 22 - 3.3 - 13.1, 0.01), `got ${out.netProfit}`);

// 3. Beauty BSR 5,015 -> ~2,200-2,640/mo (published JS/Helium10 range).
const beauty = estimateVelocity({ bsr: 5015, category: "Beauty" });
check("Beauty BSR 5015 estimate in published range", beauty.monthlySales >= 2000 && beauty.monthlySales <= 2800, `got ${beauty.monthlySales}`);
check("model-only estimate is low confidence", beauty.confidence === "low");

// 4. A bought-in-past-month floor beats the model.
const floored = estimateVelocity({ bsr: 90000, category: "Beauty", boughtPastMonth: 1000 });
check("bought-past-month floor respected", floored.monthlySales >= 1000 && floored.confidence === "high", JSON.stringify(floored));

// 5. Days to clear: 600/mo, 3 FBA offers -> 10 units in 1.5 days.
const d = daysToClear(10, { monthlySales: 600, low: 420, high: 780, basis: "bsr-model", confidence: "low" }, { fbaOffers: 3 });
check("daysToClear math", near(d, 1.5, 0.01), `got ${d}`);

// 6. No signals -> UNKNOWN, never BUY.
const unknown = evaluateDeal({ buyPrice: 10, sellPrice: 30 });
check("no-BSR deal is UNKNOWN", unknown.verdict === "UNKNOWN", unknown.verdict);

// 7. Research example through the verdict: BUY at $22, SKIP at $19.
const buy = evaluateDeal({ buyPrice: 8, sellPrice: 22, bsr: 5015, category: "Beauty" }, { costs: { prepPerUnit: 0.75, inboundPerUnit: 0.45, fbaFee: 3.55, storagePerUnit: 0.35 } });
check("worked example verdict BUY at $22", buy.verdict === "BUY", JSON.stringify(buy.reasons));
const skip = evaluateDeal({ buyPrice: 8, sellPrice: 19, bsr: 5015, category: "Beauty" }, { costs: { prepPerUnit: 0.75, inboundPerUnit: 0.45, fbaFee: 3.55, storagePerUnit: 0.35 } });
check("worked example verdict SKIP at $19 (below floor)", skip.verdict === "SKIP", JSON.stringify(skip.reasons));

// 8. Slow mover: BSR 900k at qty 20 -> SKIP on velocity even with a fat margin.
const slow = evaluateDeal({ buyPrice: 5, sellPrice: 60, bsr: 900000, category: "Electronics" }, { qty: 20 });
check("slow mover SKIP on velocity", slow.verdict === "SKIP", JSON.stringify(slow.reasons));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
