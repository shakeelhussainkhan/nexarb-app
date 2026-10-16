// Offline harness for pack normalization (lib/suppliers/packNormalizeCore.ts)
// and its wiring in the evaluation core (lib/suppliers/evaluateCore.ts):
// the five hand-vetted 2026-10-16 Frontier fixtures (every one a pack
// mismatch), the GTIN-14 refusal, and the single-unit controls.
// v2 adds the REAL listing titles from the first post-deploy production
// evaluate batch whose pack declarations v1 missed ("N per case",
// "size x N", "NPk", "N Units", "Box/Set of N") plus their negatives.
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-pack-normalization.mjs
// Pure-logic tests — NO network, NO database.
import {
  supplierUpcKind,
  detectListingPackQty,
  normalizeEconomics,
  analyzeListingPack,
} from "@/lib/suppliers/packNormalizeCore.ts";
import { evaluateOffer } from "@/lib/suppliers/evaluateCore.ts";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}
const near = (a, b, eps = 0.011) => typeof a === "number" && Math.abs(a - b) <= eps;
const hasReason = (ev, frag) => ev.reasons.some((r) => r.includes(frag));

// --- supplierUpcKind -----------------------------------------------------------
{
  check("upc: 12-digit UPC-A → each", supplierUpcKind("873562001866") === "each");
  check("upc: UNREAL GTIN-14 (indicator 1) → case_gtin14", supplierUpcKind("10857484006540") === "case_gtin14");
  check("upc: GTIN-14 with indicator 0 → each (padded UPC-A)", supplierUpcKind("00873562001866") === "each");
  check("upc: GTIN-14 with indicator 9 → unknown", supplierUpcKind("92345678901234") === "unknown");
  check("upc: short junk → unknown", supplierUpcKind("123") === "unknown");
  check("upc: null → unknown", supplierUpcKind(null) === "unknown");
}

// --- detectListingPackQty: explicit declarations --------------------------------
{
  const cases = [
    ["Wicked Joe Coffee Wicked Italian Medium Dark Roast Ground Coffee, 12 Ounce (Pack of 6)", 6],
    ["Wholesome Sweeteners Turbinado Raw Cane Sugar, 24 Ounce (Pack of 12)", 12],
    ["Wholesome Sweeteners Turbinado Raw Cane Sugar, 24 Ounce — Case of 12", 12],
    ["Simply Organic Black Pepper, Certified Organic, 4 oz, Pack of 6", 6],
    ["UNREAL Dark Chocolate Coconut Bars, 4.2 Ounce (Pack of 6)", 6],
    ["Chocolove Chocolate Bar, Almonds & Sea Salt in Dark Chocolate, 1.3 Ounce (Pack of 12)", 12],
    ["Sparkling Spring Water, 12-Pack", 12],
    ["Vitamin D3 Softgels, 120 Count", 120],
    ["Cold Brew Coffee Concentrate, 6 x 12 oz Bottles", 6],
    // v2 shapes — REAL titles from the first post-deploy production
    // evaluate batch (2026-10-16) that v1 missed and wrongly scored
    // as single units:
    ["Aura Cacia Ginger/Mint Aromatherapy Mist, 4 Ounce - 6 per case.6", 6],
    ["Equal Exchange Organic Mint Crunch Dark Chocolate Bar, 2.8 Ounce -- 12 per case.", 12],
    ["Equal Exchange Organic Colombian Drip Ground Coffee, 12 Ounce - 6 per case.6", 6],
    ["Theo Chocolate Organic Salted Almond 70 Percentage Dark Chocolate Bar, 3 Ounce - 12 per case.", 12],
    ["Lily Of The Desert Aloe Vera Gel, 32 Ounce - 6 per case.", 6],
    ["Nutiva Organic Organic Coconut Oil, 29 Ounce - 6 per case.", 6],
    ["Maple Valley Organic Maple Syrup Grade A Dark and Robust 1 oz Nips x 96 Wedding Favors/Party Favors/...", 96],
    ["The Ginger People Organic Grated Ginger Bulk Ready-to-Use 6.7oz 12Pk", 12],
    ["Lip Balm - Spearmint Lip Smoothee, 24 Units / 0.18 oz", 24],
    ["Tea Sampler, Box of 20", 20],
    ["Scented Candle, Set of 3", 3],
    ["Bar Soap, 4 per box", 4],
    ["Shampoo, 12 oz x 12", 12],
  ];
  for (const [title, qty] of cases) {
    const d = detectListingPackQty(title);
    check(`detect: "${title.slice(0, 42)}…" → ${qty}`, d.packQty === qty && d.confidence === "explicit",
      `got ${d.packQty}/${d.confidence} (${d.evidence})`);
  }
}

// --- detectListingPackQty: derived size division ---------------------------------
{
  const viaUnitCount = detectListingPackQty("Simply Organic Black Pepper 4 oz", "24 Ounce");
  check("derived: unit-count 24 oz ÷ title unit 4 oz → 6",
    viaUnitCount.packQty === 6 && viaUnitCount.confidence === "derived",
    `got ${viaUnitCount.packQty}/${viaUnitCount.confidence}`);
  const inTitle = detectListingPackQty("Organic Maple Syrup, 24 oz total, 12 oz bottle");
  check("derived: in-title total 24 oz ÷ unit 12 oz → 2",
    inTitle.packQty === 2 && inTitle.confidence === "derived",
    `got ${inTitle.packQty}/${inTitle.confidence}`);
}

// --- detectListingPackQty: conservative defaults -----------------------------------
{
  const single = detectListingPackQty("Wicked Joe Coffee Wicked Italian Ground Coffee, 12 Ounce Bag");
  check("default: no declaration → 1 / none", single.packQty === 1 && single.confidence === "none",
    `got ${single.packQty}/${single.confidence}`);
  const vague = detectListingPackQty("Family Size Cereal — Value Pack, Multipack");
  check("default: vague words never move it → 1 / none", vague.packQty === 1 && vague.confidence === "none",
    `got ${vague.packQty}/${vague.confidence}`);
  const packOfOne = detectListingPackQty("Coffee, 12 Ounce (Pack of 1)");
  check("default: Pack of 1 → 1 but explicit", packOfOne.packQty === 1 && packOfOne.confidence === "explicit",
    `got ${packOfOne.packQty}/${packOfOne.confidence}`);
  const noTitle = detectListingPackQty(null);
  check("default: null title → 1 / none", noTitle.packQty === 1 && noTitle.confidence === "none");
  // v2 negative controls — real production titles with NO pack
  // declaration; bare sizes and stray digit strings must never fire:
  const nagChampa = detectListingPackQty("Nag Champa Incense");
  check("default: 'Nag Champa Incense' → 1 / none", nagChampa.packQty === 1 && nagChampa.confidence === "none",
    `got ${nagChampa.packQty}/${nagChampa.confidence}`);
  const emerita = detectListingPackQty("Emerita Cream Body Phytoestrogen");
  check("default: 'Emerita Cream Body Phytoestrogen' → 1 / none", emerita.packQty === 1 && emerita.confidence === "none",
    `got ${emerita.packQty}/${emerita.confidence}`);
  const beefSticks = detectListingPackQty("Vermont Smoke 2410563 Premium Beef Sticks 6 oz");
  check("default: bare size + SKU digits → 1 / none", beefSticks.packQty === 1 && beefSticks.confidence === "none",
    `got ${beefSticks.packQty}/${beefSticks.confidence} (${beefSticks.evidence})`);
  const packOfOneJoe = detectListingPackQty("Wicked Joe Coffee Wicked Italian Ground Coffee, 12 Ounce (Pack of 1)");
  check("default: Wicked Joe (Pack of 1) → 1 but explicit", packOfOneJoe.packQty === 1 && packOfOneJoe.confidence === "explicit",
    `got ${packOfOneJoe.packQty}/${packOfOneJoe.confidence}`);
}

// --- The five fixtures: normalized unit price + economics gate ----------------------
// [name, upc, cost, amazonPrice, listingTitle, expectedUnit | "REFUSED"]
const FIXTURES = [
  ["Wicked Joe", "873562001866", 12.20, 105.07,
    "Wicked Joe Coffee Wicked Italian Medium Dark Roast Ground Coffee, 12 Ounce (Pack of 6)", 17.51],
  ["Wholesome Turbinado", "012511467715", 4.29, 72.84,
    "Wholesome Sweeteners Turbinado Raw Cane Sugar, 24 Ounce (Pack of 12)", 6.07],
  ["Simply Organic Black Pepper", "089836194954", 8.27, 62.04,
    "Simply Organic Black Pepper, Certified Organic, 4 oz, Pack of 6", 10.34],
  ["UNREAL Coconut Bars", "10857484006540", 5.20, 38.30,
    "UNREAL Dark Chocolate Coconut Bars, 4.2 Ounce (Pack of 6)", "REFUSED"],
  ["Chocolove Mini Bar", "716270051559", 1.85, 26.90,
    "Chocolove Chocolate Bar, Almonds & Sea Salt in Dark Chocolate, 1.3 Ounce (Pack of 12)", 2.24],
];
for (const [name, upc, , amazonPrice, title, expected] of FIXTURES) {
  const norm = analyzeListingPack({ listingTitle: title, upc, amazonPrice });
  if (expected === "REFUSED") {
    check(`fixture ${name}: GTIN-14 refused`, norm.status === "unverified_case_upc" && norm.unitAmazonPrice === null,
      `got ${norm.status}/${norm.unitAmazonPrice}`);
  } else {
    check(`fixture ${name}: unit price $${expected}`, norm.status === "ok" && near(norm.unitAmazonPrice, expected),
      `got ${norm.status}/${norm.unitAmazonPrice}`);
  }
}
{
  // v2 end-to-end: a "per case" title normalizes the price basis
  // (Aura Cacia mist: $79.16 buys a case of 6 → $13.19 per unit).
  const aura = analyzeListingPack({
    listingTitle: "Aura Cacia Ginger/Mint Aromatherapy Mist, 4 Ounce - 6 per case.6",
    upc: null,
    amazonPrice: 79.16,
  });
  check("v2 fixture Aura Cacia: per-case → unit price $13.19",
    aura.status === "ok" && aura.packQty === 6 && near(aura.unitAmazonPrice, 13.19),
    `got ${aura.status}/${aura.packQty}/${aura.unitAmazonPrice}`);
  const refused = normalizeEconomics({ amazonPrice: 38.30, packQty: 6, upcKind: "case_gtin14" });
  check("normalizeEconomics: case_gtin14 → refused, no unit price",
    refused.status === "unverified_case_upc" && refused.unitAmazonPrice === null);
  const ok = normalizeEconomics({ amazonPrice: 105.07, packQty: 6, upcKind: "each" });
  check("normalizeEconomics: each ÷ 6 → 17.51", ok.status === "ok" && near(ok.unitAmazonPrice, 17.51),
    `got ${ok.unitAmazonPrice}`);
}

// --- End-to-end through evaluateOffer: no fixture may be a candidate ---------------
const FRONTIER_SIGNALS = {
  bsr: 5000, // strong velocity — economics alone decided the old (wrong) verdicts
  category: null,
  eligibility: "ELIGIBLE",
  stockAtSupplier: null, // Frontier shape: feed carries no counts
};
for (const [name, upc, cost, amazonPrice, title, expected] of FIXTURES) {
  const ev = evaluateOffer(
    { supplier: "frontier", title: `fixture ${name}`, brand: null, productClass: null, subcategory: null, costPrice: cost },
    { ...FRONTIER_SIGNALS, amazonPrice, listingTitle: title, supplierUpc: upc }
  );
  check(`e2e ${name}: not a candidate`, ev.verdict !== "candidate", `got ${ev.verdict} (net ${ev.freightNet})`);
  if (expected === "REFUSED") {
    check(`e2e ${name}: pass + GTIN-14 reason + packStatus`,
      ev.verdict === "pass" && ev.packStatus === "unverified_case_upc" && hasReason(ev, "unverified case UPC"),
      `${ev.verdict}/${ev.packStatus} | ${ev.reasons.join(" | ")}`);
  } else {
    check(`e2e ${name}: pack_normalized reason states unit price $${expected}`,
      hasReason(ev, `pack_normalized: listing pack of ${ev.packQty} → unit price $${expected.toFixed(2)}`),
      ev.reasons.join(" | "));
    check(`e2e ${name}: unitAmazonPrice $${expected}`, near(ev.unitAmazonPrice, expected), `got ${ev.unitAmazonPrice}`);
  }
}

// --- Controls ------------------------------------------------------------------------
// True single-unit listing: pack 1, economics byte-identical to the legacy
// no-title call, verdict unchanged.
{
  const offer = {
    supplier: "petra",
    title: "DieHard AA Alkaline Battery 16 Pack",
    brand: "DieHard",
    productClass: null,
    subcategory: null,
    costPrice: 4.49,
  };
  const signals = { amazonPrice: 24.95, bsr: 5000, category: null, eligibility: "ELIGIBLE", stockAtSupplier: 5 };
  const legacy = evaluateOffer(offer, signals);
  const withTitle = evaluateOffer(offer, {
    ...signals,
    listingTitle: "DieHard AA Alkaline Batteries — 16 Batteries, Long-Lasting Power",
    supplierUpc: "035355411041",
  });
  check("control single-unit: packQty 1", withTitle.packQty === 1, `got ${withTitle.packQty}`);
  check("control single-unit: economics unchanged",
    near(withTitle.freightNet, legacy.freightNet) && near(withTitle.baseNet, legacy.baseNet),
    `${withTitle.freightNet} vs ${legacy.freightNet}`);
  check("control single-unit: verdict unchanged (candidate)", withTitle.verdict === legacy.verdict && withTitle.verdict === "candidate",
    `${withTitle.verdict} vs ${legacy.verdict}`);
  check("control single-unit: legacy call has NO pack reasons",
    !legacy.reasons.some((r) => r.startsWith("pack_")), legacy.reasons.join(" | "));
  check("control single-unit: no-declaration title flagged low-confidence",
    hasReason(withTitle, "pack_check: no explicit pack declaration"), withTitle.reasons.join(" | "));
}
// Title explicitly null (caller opted in, live fetch failed): flagged, not silent.
{
  const ev = evaluateOffer(
    { supplier: "frontier", title: "Some Frontier Offer", brand: null, productClass: null, subcategory: null, costPrice: 4.49 },
    { ...FRONTIER_SIGNALS, amazonPrice: 24.95, listingTitle: null, supplierUpc: "035355411041" }
  );
  check("control null title: flagged title-unavailable", hasReason(ev, "pack_check: Amazon listing title unavailable"),
    ev.reasons.join(" | "));
  check("control null title: packQty 1", ev.packQty === 1, `got ${ev.packQty}`);
}
// GTIN-14 refuses even when the listing title declares nothing.
{
  const ev = evaluateOffer(
    { supplier: "frontier", title: "UNREAL Dark Chocolate Coconut Bars 4.2 oz.", brand: "UNREAL", productClass: null, subcategory: null, costPrice: 5.20 },
    { ...FRONTIER_SIGNALS, amazonPrice: 38.30, listingTitle: "UNREAL Dark Chocolate Coconut Bars, 4.2 Ounce Bag", supplierUpc: "10857484006540" }
  );
  check("control GTIN-14 no-declaration: still refused", ev.verdict === "pass" && ev.packStatus === "unverified_case_upc",
    `${ev.verdict}/${ev.packStatus}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

