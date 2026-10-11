// Offline harness for inventory + repricing rules. Run: node scripts/verify-repricing.mjs
import { inventoryHealth, reorderQty } from "../lib/engine/inventory.ts";
import { decideRepricing } from "../lib/engine/repricing.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// Inventory tripwires
check("10 units @1/day = stockout-risk", inventoryHealth(10, 1).status === "stockout-risk");
check("60 units @1/day = healthy", inventoryHealth(60, 1).status === "healthy");
check("120 units @1/day = watch", inventoryHealth(120, 1).status === "watch");
check("170 units @1/day = excess", inventoryHealth(170, 1).status === "excess");
check("300 units @1/day = aged-risk", inventoryHealth(300, 1).status === "aged-risk");
check("old units trigger aged-risk even with low supply", inventoryHealth(5, 1, 200).status === "aged-risk");
check("no sell rate -> watch, daysOfSupply null", (() => { const h = inventoryHealth(50, 0); return h.status === "watch" && h.daysOfSupply === null; })());
check("reorderQty tops up to 45d", reorderQty(10, 1, 45) === 35);
check("reorderQty zero when stocked", reorderQty(100, 1, 45) === 0);

// Repricing rules
const below = decideRepricing({ currentPrice: 18, floorPrice: 20.15, competitorOffers: 3, daysOfSupply: 60 });
check("below-floor price restored to floor", below.action === "raise" && below.newPrice === 20.15, JSON.stringify(below));

const aged = decideRepricing({ currentPrice: 25, floorPrice: 20.15, competitorOffers: 3, daysOfSupply: 200, oldestUnitAgeDays: 160 });
check("aged stock markdowns but never below floor", aged.action === "markdown" && aged.newPrice >= 20.15 && aged.newPrice < 25, JSON.stringify(aged));

const agedAtFloor = decideRepricing({ currentPrice: 20.15, floorPrice: 20.15, competitorOffers: 3, daysOfSupply: 200, oldestUnitAgeDays: 170 });
check("aged stock at floor holds (liquidation is a human call)", agedAtFloor.action === "hold", JSON.stringify(agedAtFloor));

const alone = decideRepricing({ currentPrice: 22, floorPrice: 20.15, ceilingPrice: 26, competitorOffers: 1, daysOfSupply: 60 });
check("sole offer raises toward ceiling", alone.action === "raise" && alone.newPrice > 22 && alone.newPrice <= 26, JSON.stringify(alone));

const lowSupply = decideRepricing({ currentPrice: 22, floorPrice: 20.15, competitorOffers: 3, daysOfSupply: 10 });
check("low supply raises to slow burn", lowSupply.action === "raise" && lowSupply.newPrice > 22, JSON.stringify(lowSupply));

const crowded = decideRepricing({ currentPrice: 24, floorPrice: 20.15, competitorOffers: 8, daysOfSupply: 60 });
check("crowded listing steps down, floor held", crowded.action === "lower" && crowded.newPrice >= 20.15, JSON.stringify(crowded));

const balanced = decideRepricing({ currentPrice: 22, floorPrice: 20.15, competitorOffers: 3, daysOfSupply: 60 });
check("balanced listing holds", balanced.action === "hold" && balanced.newPrice === 22, JSON.stringify(balanced));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
