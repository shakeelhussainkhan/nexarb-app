// Offline harness for the suspect-multipack guard
// (lib/suppliers/suspectMultipackCore.ts) and its wiring in the
// evaluation core (lib/suppliers/evaluateCore.ts): the three
// hand-vetted 2026-10-17 Frontier mirage fixtures, the confirmed-pack
// controls, the threshold boundaries, and the legacy-path contract.
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-suspect-multipack.mjs
// Pure-logic tests — NO network, NO database.
//
// FIXTURE SHAPE NOTE: the core fixtures use the titles the pipeline
// actually sees (SP-API Catalog summaries) — on all three ASINs the
// pack count lives in the listing BODY, not the title, which is
// exactly why v2 normalization could not rescue them and the guard
// exists. (The full Amazon titles, which DO declare the packs, are
// covered by the confirmed-pack controls below and by
// verify-pack-normalization.mjs.)
import {
  detectSuspectMultipack,
  SUSPECT_RATIO_THRESHOLD,
} from "@/lib/suppliers/suspectMultipackCore.ts";
import { evaluateOffer, CANDIDATE_MIN_NET } from "@/lib/suppliers/evaluateCore.ts";

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

// --- The three vetted mirage fixtures: all suspect ------------------------------
// [name, amazonPrice, supplierUnitCost, pipelineTitle, expectedRatio]
const MIRAGES = [
  ["Simply Organic Black Pepper (B008QMYYQA)", 62.04, 8.27,
    "Simply Organic Black Pepper, Certified Organic, 4 oz", 7.5],
  ["UNREAL Coconut Bars (B07RWNNCP3)", 38.30, 5.20,
    "UNREAL Dark Chocolate Coconut Bars, 4.2 Ounce Bag", 7.37],
  ["Chocolove Mini Bar (B0083COTOA)", 26.90, 1.85,
    "Chocolove Chocolate Bar, Almonds & Sea Salt in Dark Chocolate, 1.3 Ounce", 14.54],
];
for (const [name, amazonPrice, cost, title, expectedRatio] of MIRAGES) {
  const v = detectSuspectMultipack({ amazonPrice, supplierUnitCost: cost, listingTitle: title });
  check(`mirage ${name}: suspect`, v.suspect === true, JSON.stringify(v));
  check(`mirage ${name}: ratio ${expectedRatio}×`, near(v.ratio, expectedRatio) && near(v.normalizedRatio, expectedRatio),
    `got ${v.ratio}/${v.normalizedRatio}`);
  check(`mirage ${name}: no pack confirmed`, v.packQty === 1, `got ${v.packQty}`);
  check(`mirage ${name}: reason names the fingerprint`,
    v.reason.startsWith("suspect_multipack:") && v.reason.includes("no confirmed pack declaration"),
    v.reason);
}

// --- Legitimate high-margin single: not suspect ---------------------------------
{
  const v = detectSuspectMultipack({
    amazonPrice: 17.99,
    supplierUnitCost: 6.50,
    listingTitle: "Stainless Steel Sink Caddy with Drain Spout",
  });
  check("legit single: not suspect", v.suspect === false, JSON.stringify(v));
  check("legit single: ratio 2.77×", near(v.ratio, 2.77) && near(v.normalizedRatio, 2.77),
    `got ${v.ratio}/${v.normalizedRatio}`);
}

// --- Confirmed pack with a sane normalized ratio: not suspect --------------------
{
  // Caller-supplied pack (the evaluateCore path: analyzeListingPack
  // already ran). Wicked Joe: $105.07 ÷ 6 = $17.51 vs $12.20 cost.
  const v = detectSuspectMultipack({
    amazonPrice: 105.07,
    supplierUnitCost: 12.20,
    packQty: 6,
    packConfidence: "explicit",
  });
  check("confirmed 6-pack (caller pack): not suspect", v.suspect === false, JSON.stringify(v));
  check("confirmed 6-pack (caller pack): normalized ratio 1.44×",
    near(v.ratio, 8.61) && near(v.normalizedRatio, 1.44), `got ${v.ratio}/${v.normalizedRatio}`);
  check("confirmed 6-pack (caller pack): pack applied", v.packQty === 6, `got ${v.packQty}`);
}
{
  // Title-derived pack (the standalone path: same v2 parser).
  const v = detectSuspectMultipack({
    amazonPrice: 105.07,
    supplierUnitCost: 12.20,
    listingTitle: "Wicked Joe Coffee Wicked Italian Medium Dark Roast Ground Coffee, 12 Ounce (Pack of 6)",
  });
  check("confirmed 6-pack (title-derived): not suspect", v.suspect === false && v.packQty === 6,
    JSON.stringify(v));
  check("confirmed 6-pack (title-derived): normalized ratio 1.44×", near(v.normalizedRatio, 1.44),
    `got ${v.normalizedRatio}`);
}
{
  // A complete declaration rescues even a mirage-shaped raw ratio:
  // Chocolove money with its real "Pack of 12" confirmed.
  const v = detectSuspectMultipack({
    amazonPrice: 26.90,
    supplierUnitCost: 1.85,
    packQty: 12,
    packConfidence: "explicit",
  });
  check("confirmed 12-pack rescues raw 14.54×: not suspect",
    v.suspect === false && near(v.normalizedRatio, 1.21), JSON.stringify(v));
}
{
  // A "none" confidence NEVER confirms a caller packQty — the
  // unconfirmed case is the guard's whole target.
  const v = detectSuspectMultipack({
    amazonPrice: 105.07,
    supplierUnitCost: 12.20,
    packQty: 6,
    packConfidence: "none",
  });
  check("packQty with confidence 'none' does not confirm: suspect",
    v.suspect === true && v.packQty === 1 && near(v.normalizedRatio, 8.61), JSON.stringify(v));
}

// --- Confirmed pack whose NORMALIZED ratio is still > 4: suspect ------------------
{
  const v = detectSuspectMultipack({
    amazonPrice: 120.0,
    supplierUnitCost: 3.0,
    packQty: 6,
    packConfidence: "explicit",
  });
  check("confirmed pack, normalized 6.67×: suspect", v.suspect === true, JSON.stringify(v));
  check("confirmed pack, normalized 6.67×: ratios",
    near(v.ratio, 40) && near(v.normalizedRatio, 6.67), `got ${v.ratio}/${v.normalizedRatio}`);
  check("confirmed pack, normalized 6.67×: reason says the pack does not explain it",
    v.reason.startsWith("suspect_multipack:") && v.reason.includes("does not explain the spread"),
    v.reason);
}

// --- Threshold boundaries + unusable inputs ---------------------------------------
{
  check("threshold constant is 4.0", SUSPECT_RATIO_THRESHOLD === 4.0);
  const at = detectSuspectMultipack({ amazonPrice: 40.0, supplierUnitCost: 10.0 });
  check("ratio exactly 4.00×: not suspect (strict >)", at.suspect === false && near(at.ratio, 4.0),
    JSON.stringify(at));
  const over = detectSuspectMultipack({ amazonPrice: 40.10, supplierUnitCost: 10.0 });
  check("ratio 4.01×: suspect", over.suspect === true && near(over.ratio, 4.01), JSON.stringify(over));
  const noCost = detectSuspectMultipack({ amazonPrice: 50.0, supplierUnitCost: 0 });
  check("zero cost: not suspect, null ratios",
    noCost.suspect === false && noCost.ratio === null && noCost.normalizedRatio === null,
    JSON.stringify(noCost));
  const noPrice = detectSuspectMultipack({ amazonPrice: 0, supplierUnitCost: 5.0 });
  check("zero price: not suspect, null ratios",
    noPrice.suspect === false && noPrice.ratio === null, JSON.stringify(noPrice));
}

// --- End-to-end through evaluateOffer ----------------------------------------------
const FRONTIER_SIGNALS = {
  bsr: 5000, // strong velocity — economics alone decided the old (wrong) verdicts
  category: null,
  eligibility: "ELIGIBLE",
  stockAtSupplier: null, // Frontier shape: feed carries no counts
};
const frontierOffer = (title, costPrice) => ({
  supplier: "frontier",
  title,
  brand: null,
  productClass: null,
  subcategory: null,
  costPrice,
});
{
  const ev = evaluateOffer(
    frontierOffer("Simply Organic Black Pepper 4 oz", 8.27),
    { ...FRONTIER_SIGNALS, amazonPrice: 62.04, listingTitle: MIRAGES[0][3], supplierUpc: "089836194954" }
  );
  check("e2e pepper: suppressed to pass", ev.verdict === "pass", `got ${ev.verdict}`);
  check("e2e pepper: suspectMultipack + ratio 7.50×",
    ev.suspectMultipack === true && near(ev.suspectRatio, 7.5), `${ev.suspectMultipack}/${ev.suspectRatio}`);
  check("e2e pepper: suspect reason recorded", hasReason(ev, "suspect_multipack:"), ev.reasons.join(" | "));
  check("e2e pepper: mirage economics preserved for audit (net clears the candidate bar)",
    ev.freightNet >= CANDIDATE_MIN_NET, `got net ${ev.freightNet}`);
  check("e2e pepper: score capped at 10", ev.score <= 10, `got ${ev.score}`);
}
{
  const ev = evaluateOffer(
    frontierOffer("Chocolove Mini Bar 1.3 oz", 1.85),
    { ...FRONTIER_SIGNALS, amazonPrice: 26.90, listingTitle: MIRAGES[2][3], supplierUpc: "716270051559" }
  );
  check("e2e chocolove: suppressed to pass + suspect",
    ev.verdict === "pass" && ev.suspectMultipack === true && near(ev.suspectRatio, 14.54),
    `${ev.verdict}/${ev.suspectMultipack}/${ev.suspectRatio}`);
}
{
  // The guard alone (each-UPC, no GTIN-14 refusal in play) still
  // catches the UNREAL economics shape.
  const ev = evaluateOffer(
    frontierOffer("UNREAL Dark Chocolate Coconut Bars 4.2 oz", 5.20),
    { ...FRONTIER_SIGNALS, amazonPrice: 38.30, listingTitle: MIRAGES[1][3], supplierUpc: "012345678905" }
  );
  check("e2e unreal shape (each UPC): guard alone suppresses",
    ev.verdict === "pass" && ev.suspectMultipack === true && ev.packStatus === "ok",
    `${ev.verdict}/${ev.suspectMultipack}/${ev.packStatus}`);
}
{
  // With its real case-level GTIN-14, UNREAL is refused by pack
  // normalization first — and the evaluation still carries the
  // guard's verdict for the response count.
  const ev = evaluateOffer(
    frontierOffer("UNREAL Dark Chocolate Coconut Bars 4.2 oz", 5.20),
    { ...FRONTIER_SIGNALS, amazonPrice: 38.30, listingTitle: MIRAGES[1][3], supplierUpc: "10857484006540" }
  );
  check("e2e unreal (GTIN-14): pass + refusal status + suspect flag",
    ev.verdict === "pass" && ev.packStatus === "unverified_case_upc" && ev.suspectMultipack === true,
    `${ev.verdict}/${ev.packStatus}/${ev.suspectMultipack}`);
}
{
  // Confirmed pack + sane normalized ratio: the guard stays out of
  // the way and honest pack economics can still produce a candidate.
  // (Price sits exactly at the guard boundary: $120 ÷ 6 ÷ $5 = 4.00×.)
  const ev = evaluateOffer(
    { supplier: "petra", title: "Organic Ground Coffee 12 oz (Pack of 6)", brand: null, productClass: null, subcategory: null, costPrice: 5.0 },
    { amazonPrice: 120.0, bsr: 5000, category: null, eligibility: "ELIGIBLE", stockAtSupplier: 10,
      listingTitle: "Organic Ground Coffee, 12 Ounce (Pack of 6)", supplierUpc: "012345678905" }
  );
  check("e2e confirmed pack: not suspect", ev.suspectMultipack === false && near(ev.suspectRatio, 4.0),
    `${ev.suspectMultipack}/${ev.suspectRatio}`);
  check("e2e confirmed pack: candidate on normalized economics", ev.verdict === "candidate",
    `${ev.verdict} | ${ev.reasons.join(" | ")}`);
}
{
  // Legacy path: no pack inputs at all — the guard cannot run and
  // the pre-v3 verdict stands even at a >4× ratio (the
  // verify-evaluate.mjs contract).
  const ev = evaluateOffer(
    { supplier: "petra", title: "DieHard AA Alkaline Battery 16 Pack", brand: "DieHard", productClass: null, subcategory: null, costPrice: 4.49 },
    { amazonPrice: 24.95, bsr: 5000, category: null, eligibility: "ELIGIBLE", stockAtSupplier: 5 }
  );
  check("e2e legacy path: candidate unchanged, guard inactive",
    ev.verdict === "candidate" && ev.suspectMultipack === false && ev.suspectRatio === null,
    `${ev.verdict}/${ev.suspectMultipack}/${ev.suspectRatio}`);
  check("e2e legacy path: no suspect reason",
    !ev.reasons.some((r) => r.includes("suspect")), ev.reasons.join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
