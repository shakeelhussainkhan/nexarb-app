// Offline harness for the Frontier Co-op supplier core
// (lib/suppliers/frontierCore.ts): both sheet layouts against fixtures
// excerpted from the real published files, the per-unit price basis, UPC
// rules, duplicate-SKU collapse, and the generalized ingest coercion pin.
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-frontier.mjs
// Pure-logic tests — NO network, NO database.
import { readFileSync } from "node:fs";
import {
  parseFrontierRows,
  detectFrontierLayout,
  normalizeFrontierUpc,
  FRONTIER_SUPPLIER,
} from "@/lib/suppliers/frontierCore.ts";
import { coerceSupplierOffer } from "@/lib/suppliers/petraCore.ts";

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
const near = (a, b, eps = 0.0001) => typeof a === "number" && Math.abs(a - b) <= eps;

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/frontier-rows.json", import.meta.url), "utf8")
);

// --- UPC normalization --------------------------------------------------------
{
  check("upc: hyphenated 12-digit", normalizeFrontierUpc("0-89836-19852-5") === "089836198525");
  check("upc: hyphenated 13-digit", normalizeFrontierUpc("7-92850-02730-5") === "792850027305");
  check("upc: bare 14-digit", normalizeFrontierUpc("10874492005884") === "10874492005884");
  check("upc: numeric cell", normalizeFrontierUpc(89836198525) === null, "11 digits after leading-zero loss → null");
  check("upc: 11-digit → null", normalizeFrontierUpc("81014072580") === null);
  check("upc: blank → null", normalizeFrontierUpc("") === null && normalizeFrontierUpc(null) === null);
}

// --- Annual catalog layout ------------------------------------------------------
// Fixture: vanilla 19852, Burt's Bees 240602, Theo 243479, an 11-digit-UPC
// row (242213), and one row with its Whls Price nulled (must be skipped).
{
  check("layout: annual detected", detectFrontierLayout(fixture.annual) === "annual");
  const { offers, stats, errors } = parseFrontierRows(fixture.annual);
  check("annual: no errors", errors.length === 0, errors.join("; "));
  check("annual: 4 parsed, 1 skipped (missing price)",
    offers.length === 4 && stats.skipped === 1 && stats.dataRows === 5, JSON.stringify(stats));
  check("annual: 1 missing UPC (11-digit row)", stats.missingUpc === 1, `got ${stats.missingUpc}`);

  const vanilla = offers.find((o) => o.supplierSku === "19852");
  check("vanilla: found", !!vanilla);
  check("vanilla: supplier pinned", vanilla?.supplier === FRONTIER_SUPPLIER && vanilla?.supplier === "frontier");
  // PRICE BASIS: file Whls Price 27.74 at Case Count 6 == the portal's
  // per-unit "Your Price" $27.74 — the parser must NOT divide by case.
  check("vanilla: cost is PER UNIT 27.74 (not 27.74/6)", near(vanilla?.costPrice, 27.74),
    `got ${vanilla?.costPrice}`);
  check("vanilla: msrp from SRP", near(vanilla?.msrp, 39.99), `got ${vanilla?.msrp}`);
  check("vanilla: upc stripped", vanilla?.upc === "089836198525", `got ${vanilla?.upc}`);
  check("vanilla: title is Long Product Name",
    vanilla?.title === "Simply Organic Pure Madagascar Vanilla Extract 8 fl. oz.", vanilla?.title);
  check("vanilla: brand", vanilla?.brand === "Simply Organic");
  check("vanilla: gross weight", near(vanilla?.weightLb, 0.94), `got ${vanilla?.weightLb}`);
  check("vanilla: qty 0 = stock unknown (files carry no counts)", vanilla?.qtyAvailable === 0);

  const burts = offers.find((o) => o.supplierSku === "240602");
  check("annual: 13-digit hyphenated UPC", burts?.upc === "792850027305", `got ${burts?.upc}`);
  const theo = offers.find((o) => o.supplierSku === "243479");
  check("annual: 14-digit UPC kept", theo?.upc === "10874492005884", `got ${theo?.upc}`);
  const badUpc = offers.find((o) => o.supplierSku === "242213");
  check("annual: invalid-UPC row kept, upc null", !!badUpc && badUpc.upc === null);
}

// --- Current Prices layout ------------------------------------------------------
// Sales Price is present on (and below Wholesale on) every real row — it
// is the effective cost basis, not the list Wholesale Price.
{
  check("layout: current detected", detectFrontierLayout(fixture.current) === "current");
  const { offers, stats } = parseFrontierRows(fixture.current);
  check("current: 2 parsed", offers.length === 2, `got ${offers.length}`);
  const akronia = offers.find((o) => o.supplierSku === "242609");
  check("current: cost = Sales Price 10.80 (not Wholesale 12)", near(akronia?.costPrice, 10.8),
    `got ${akronia?.costPrice}`);
  check("current: no SRP column → msrp null", akronia?.msrp === null);
  check("current: title is Description",
    (akronia?.title ?? "").startsWith("Akronia Valley Aronia Berry"), akronia?.title);

  // Stacked promo tiers: the same SKU listed twice at different Sales
  // Prices collapses to ONE offer at the LOWEST cost.
  const dearer = { ...fixture.current[0], "Sales Price": 11.5 };
  const cheaper = { ...fixture.current[0], "Sales Price": 9.25 };
  const dup = parseFrontierRows([dearer, cheaper, fixture.current[1]]);
  check("current: duplicate SKU collapsed", dup.offers.length === 2 && dup.stats.duplicatesCollapsed === 1,
    JSON.stringify(dup.stats));
  check("current: lowest cost wins",
    near(dup.offers.find((o) => o.supplierSku === "242609")?.costPrice, 9.25));
}

// --- Failure modes ----------------------------------------------------------------
{
  const bad = parseFrontierRows([{ "Item Number": "X", Something: 1 }]);
  check("unknown layout → error, no offers", bad.offers.length === 0 && bad.errors.length === 1);
  const empty = parseFrontierRows([]);
  check("empty input → error, no offers, no crash", empty.offers.length === 0 && empty.errors.length === 1);
}

// --- Ingest coercion pin (generalized in petraCore) -------------------------------
{
  const raw = { supplierSku: "19852", title: "Vanilla", costPrice: 27.74, supplier: "petra" };
  const asFrontier = coerceSupplierOffer(raw, "frontier");
  check("coerce: frontier pin wins over body", asFrontier?.supplier === "frontier");
  const asDefault = coerceSupplierOffer(raw);
  check("coerce: default pin still petra (Petra route unchanged)", asDefault?.supplier === "petra");
  check("coerce: frontier junk → null",
    coerceSupplierOffer({ costPrice: 5 }, "frontier") === null &&
    coerceSupplierOffer({ supplierSku: "X", costPrice: 0 }, "frontier") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
