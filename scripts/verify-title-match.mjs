// Offline harness for title-based ASIN matching
// (lib/sourcing/titleMatchCore.ts + parseCatalogTitleItems in match.ts).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-title-match.mjs
// Pure-logic tests — NO network, NO database.
import {
  titleTokens,
  numericTokens,
  titleSimilarity,
  brandPasses,
  buildKeywordQuery,
  pickTitleMatch,
} from "@/lib/sourcing/titleMatchCore.ts";
import { parseCatalogTitleItems } from "@/lib/sourcing/match.ts";

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

// --- tokenization ---
check("tokens: stemming makes sponges==sponge",
  titleTokens("Scrub Sponges").join() === titleTokens("Scrub Sponge").join());
check("tokens: stopwords dropped",
  !titleTokens("Sponges with Free Holder").includes("with") &&
  !titleTokens("Sponges with Free Holder").includes("free"));
check("numeric tokens split decimals",
  [...numericTokens("Toothpaste 5.1 oz")].sort().join() === "1,5");

// --- keyword query ---
check("keyword query: brand-first, capped at 8 tokens",
  buildKeywordQuery("Scotch-Brite Heavy Duty Scrub Sponges, 6 Count, Extra Value Pack") ===
  "scotch brite heavy duty scrub sponge 6 count");

// --- similarity ---
check("similarity: identical titles = 1",
  titleSimilarity("Alpha Beta 12 Count", "Alpha Beta 12 Count") === 1);

// --- brand gate ---
const SPONGE = { asin: "B0SPONGE1", title: "Scotch-Brite Heavy Duty Scrub Sponge, 6 Count", brand: "Scotch-Brite" };
check("brand gate: same brand passes",
  brandPasses("Scotch-Brite Heavy Duty Scrub Sponges, 6 Count", SPONGE));
check("brand gate: store brand fails against national brand item",
  !brandPasses("Great Value Heavy Duty Scrub Sponges, 6 Count", SPONGE));
check("brand gate: no catalog brand -> first token must appear",
  brandPasses("Acme Dish Soap 12 oz", { asin: "X", title: "Acme Dish Soap, 12 oz", brand: null }) &&
  !brandPasses("Acme Dish Soap 12 oz", { asin: "X", title: "Zep Dish Soap, 12 oz", brand: null }));

// --- pickTitleMatch: accept ---
{
  const d = pickTitleMatch("Scotch-Brite Heavy Duty Scrub Sponges, 6 Count", [
    SPONGE,
    { asin: "B0OTHER22", title: "Scotch-Brite Lint Roller, 60 Sheets", brand: "Scotch-Brite" },
  ]);
  check("pick: plural variant accepted, correct ASIN",
    d.match?.asin === "B0SPONGE1", JSON.stringify(d));
}

// --- pickTitleMatch: reject wrong brand despite high word overlap ---
{
  const d = pickTitleMatch("Great Value Heavy Duty Scrub Sponges, 6 Count", [SPONGE]);
  check("pick: wrong brand rejected", d.match === null, JSON.stringify(d));
}

// --- pickTitleMatch: pack-size variant rejected, exact size accepted ---
{
  const items = [
    { asin: "B0TWIN222", title: "Colgate Total Whitening Toothpaste, 5.1 oz, 2 Pack", brand: "Colgate" },
    { asin: "B0SINGLE1", title: "Colgate Total Toothpaste, 5.1 oz", brand: "Colgate" },
  ];
  const d = pickTitleMatch("Colgate Total Toothpaste, 5.1 oz", items);
  check("pick: twin-pack variant skipped, single accepted",
    d.match?.asin === "B0SINGLE1", JSON.stringify(d));
  const d2 = pickTitleMatch("Colgate Total Toothpaste, 5.1 oz", [items[0]]);
  check("pick: only-variant-available still rejected (numeric gate)",
    d2.match === null, JSON.stringify(d2));
}

// --- pickTitleMatch: ambiguous near-ties rejected ---
{
  const d = pickTitleMatch("Acme Dish Soap, 12 oz", [
    { asin: "B0AAAA111", title: "Acme Dish Soap, 12 oz", brand: "Acme" },
    { asin: "B0BBBB222", title: "Acme Dish Soap, 12 oz", brand: "Acme" },
  ]);
  check("pick: identical scores = ambiguous, rejected", d.match === null, JSON.stringify(d));
}

// --- pickTitleMatch: below similarity floor rejected ---
{
  const d = pickTitleMatch("BrandX Ultra Soft Bath Tissue, 12 Count", [
    { asin: "B0TOWEL11", title: "BrandX Paper Towels, 12 Count", brand: "BrandX" },
  ]);
  check("pick: same brand+count, different product rejected (floor)",
    d.match === null, JSON.stringify(d));
}

// --- pickTitleMatch: numeric gate rejects different sizes ---
{
  const d = pickTitleMatch("Scotch-Brite Lint Roller, 60 Sheets", [SPONGE]);
  check("pick: 60-sheet roller does not match 6-count sponge", d.match === null, JSON.stringify(d));
}

// --- parseCatalogTitleItems ---
{
  const items = parseCatalogTitleItems({
    items: [
      { asin: "B1", summaries: [{ itemName: "Thing One", brand: "Acme" }] },
      { asin: "B2", summaries: [{ itemName: "Thing Two", manufacturer: "Globex" }] },
      { asin: "", summaries: [{ itemName: "No ASIN" }] },
      { asin: "B4", summaries: [{}] },
      null,
    ],
  });
  check("parse: extracts asin/title/brand, manufacturer fallback, skips junk",
    items.length === 2 && items[0].brand === "Acme" && items[1].brand === "Globex",
    JSON.stringify(items));
  check("parse: junk payload -> []",
    parseCatalogTitleItems(null).length === 0 && parseCatalogTitleItems({ items: "x" }).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
