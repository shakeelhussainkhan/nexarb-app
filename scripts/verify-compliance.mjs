// Standalone verification for the import-compliance core. No test framework
// in the repo; run with:  npm run verify:compliance
// The duty fixture is the research report's worked example (2026-10-13):
// $20,000 customs value, 5% MFN, List 4A, ocean -> $5,000 duty, $94.28
// fees, 25.47% effective.
import {
  TARIFF_2026,
  detectCategory,
  screenProduct,
  estimateDuties,
  bondCheck,
  complianceChecklist,
  validateIsf,
} from "../lib/compliance/core.ts";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// --- category detection ---
check("category: kids toy", detectCategory("Kids Wooden Toy Kitchen Set") === "childrens_product");
check("category: serum", detectCategory("Vitamin C Face Serum 30ml") === "cosmetics");
check("category: supplements", detectCategory("Magnesium Vitamin Gummies 120ct") === "food_or_supplement");
check("category: bluetooth", detectCategory("Bluetooth Wireless Earbuds Pro") === "electronics_rf");
check("category: hoodie", detectCategory("Men's Cotton Hoodie") === "textile_apparel");
check("category: cutting board (wood signal)", detectCategory("Bamboo Cutting Board Set") === "wood_or_furniture");
check("category: spatula -> general", detectCategory("Silicone Spatula Set") === "general");
check("category: childrens beats cosmetics (toy sunscreen lotion for kids?)", detectCategory("Baby Toy") === "childrens_product");

// --- screening ---
{
  const r = screenProduct({ title: "Silicone Spatula Set 5pcs", supplierName: "Shenzhen Kitchen Co" });
  check("screen: plain kitchen product clears", r.verdict === "clear" && r.reasons.length === 0, JSON.stringify(r));
}
{
  const r = screenProduct({ title: "Replica Nike Shoes Men Running", supplierName: "Fujian Shoes" });
  check("screen: replica blocked", r.verdict === "blocked", r.verdict);
  check("screen: replica also flags brand", r.reasons.length >= 2, JSON.stringify(r.reasons));
}
{
  const r = screenProduct({ title: "Xinjiang Cotton Towel Set", supplierName: "Akesu Textile" });
  check("screen: xinjiang blocked (UFLPA)", r.verdict === "blocked", r.verdict);
}
{
  const r = screenProduct({ title: "Stanley Cup Accessories Silicone Boot", supplierName: "Generic Houseware" });
  check("screen: watchlist brand -> review (not blocked)", r.verdict === "review", r.verdict);
}
{
  const r = screenProduct({ title: "Dog Fur Trim Winter Gloves", supplierName: "Harbin Furs" });
  check("screen: dog fur blocked", r.verdict === "blocked", r.verdict);
}

// --- duties: the report's worked example, exact ---
{
  const d = estimateDuties({ customsValue: 20000, originCountry: "CN", mfnRate: 0.05, section301List: "list4a", ocean: true });
  check("duty: report worked example total duty $5,000", near(d.totalDuty, 5000), String(d.totalDuty));
  check("duty: report worked example fees $94.28", near(d.totalFees, 94.28), String(d.totalFees));
  check("duty: report worked example effective 25.47%", near(d.effectiveRate * 100, 25.47, 0.01), String(d.effectiveRate));
  check("duty: formal entry above $2,500", d.formalEntry === true);
}
{
  const d = estimateDuties({ customsValue: 10000, originCountry: "CN", mfnRate: 0, section301List: "list1", ocean: false });
  // 25% 301 + 12.5% forced labour = $3,750; MPF 34.64 (above min) ; no HMF (air)
  check("duty: list1 + forced labour stack", near(d.totalDuty, 3750), String(d.totalDuty));
  check("duty: air freight has no HMF", near(d.totalFees, 34.64), String(d.totalFees));
}
{
  const d = estimateDuties({ customsValue: 1000, originCountry: "VN", mfnRate: 0.1, ocean: true });
  check("duty: non-China skips 301 + forced labour", near(d.totalDuty, 100), String(d.totalDuty));
  const mpfLine = d.lines.find((l) => l.label.startsWith("MPF"));
  check("duty: MPF floor applies on small values", mpfLine && near(mpfLine.amount, TARIFF_2026.mpfMin), JSON.stringify(mpfLine));
  check("duty: informal entry at $1,000", d.formalEntry === false);
}
{
  const d = estimateDuties({ customsValue: 50000, originCountry: "CN", mfnRate: 0.02, section232: "derivative", adcvdRate: 0.5, ocean: true });
  // MFN 1000 + FL 6250 + 232 12500 + ADCVD 25000 = 44750
  check("duty: 232 derivative + AD/CVD stack", near(d.totalDuty, 44750), String(d.totalDuty));
}

// --- bond ---
{
  const b = bondCheck({ bondAmount: 50000, trailing12mDutiesTaxesFees: 400000 });
  check("bond: $50k bond supports $400k duties", b.sufficient && near(b.utilization, 0.8), JSON.stringify(b));
  const b2 = bondCheck({ bondAmount: 50000, trailing12mDutiesTaxesFees: 600000 });
  check("bond: $50k bond insufficient at $600k duties", !b2.sufficient && near(b2.required, 60000), JSON.stringify(b2));
}

// --- checklists ---
{
  const base = complianceChecklist("general");
  check("checklist: base has 10 items", base.length === 10, String(base.length));
  const kids = complianceChecklist("childrens_product");
  check("checklist: childrens adds CPC + lab + tracking + eFiling", kids.length === 14 && kids.some((i) => i.key === "cpc") && kids.some((i) => i.key === "cpsc_efiling"), String(kids.length));
  check("checklist: CPC is manual_by_law (importer attests)", kids.find((i) => i.key === "cpc")?.automation === "manual_by_law");
  check("checklist: ISF is broker_api", base.find((i) => i.key === "isf")?.automation === "broker_api");
  check("checklist: every item has an owner + automation class", complianceChecklist("cosmetics").every((i) => i.owner && i.automation));
}

// --- ISF validation ---
{
  const full = validateIsf({
    importerOfRecord: "12-345678900", consignee: "12-345678900",
    sellerNameAddress: "Shenzhen Kitchen Co, Shenzhen, CN",
    buyerNameAddress: "Five S LLC, San Jose, CA",
    shipToNameAddress: "Automated 3PL, East Hartford, CT",
    manufacturerNameAddress: "Shenzhen Kitchen Co, Shenzhen, CN",
    countryOfOrigin: "CN", htsCode: "3924.10.4000",
    containerStuffingLocation: "Shenzhen, CN",
    consolidatorNameAddress: "Forwarder Co, Shenzhen, CN",
  });
  check("isf: complete set passes", full.complete && full.missing.length === 0, JSON.stringify(full));
  const partial = validateIsf({ importerOfRecord: "12-345678900" });
  check("isf: missing fields listed", !partial.complete && partial.missing.length === 9, JSON.stringify(partial.missing));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
