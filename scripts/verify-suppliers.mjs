// Offline harness for the Petra supplier core (lib/suppliers/petraCore.ts):
// CSV parsing, prodlist normalization against a fixture excerpted from the
// real feed, ingest-input coercion, and the margin-estimate helper.
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-suppliers.mjs
// Pure-logic tests — NO network, NO database.
import { readFileSync } from "node:fs";
import {
  parseCsvRows,
  parsePetraCsv,
  coerceSupplierOffer,
  estimateSupplierNet,
  SUPPLIER_PREP_PER_UNIT,
} from "@/lib/suppliers/petraCore.ts";

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

// --- parseCsvRows: RFC-4180 edge cases -------------------------------------
{
  const rows = parseCsvRows('a,"b,c","d""e"\r\n1,"x\ny",3\nlast,row,here');
  check("csv: row count", rows.length === 3, `got ${rows.length}`);
  check("csv: quoted comma", rows[0][1] === "b,c");
  check("csv: escaped quote", rows[0][2] === 'd"e');
  check("csv: embedded newline", rows[1][1] === "x\ny");
  check("csv: trailing row without newline", rows[2][0] === "last" && rows[2][2] === "here");
  check("csv: empty input", parseCsvRows("").length === 0);
}

// --- parsePetraCsv against the real-feed fixture ----------------------------
{
  const text = readFileSync(
    new URL("./fixtures/petra-prodlist-sample.csv", import.meta.url),
    "latin1"
  );
  const { offers, sourceFileDate, stats, errors } = parsePetraCsv(text);
  check("petra: no parse errors", errors.length === 0, errors.join("; "));
  check("petra: generated date", sourceFileDate === "2026-10-14", `got ${sourceFileDate}`);
  check("petra: parsed 5 offers", offers.length === 5, `got ${offers.length}`);
  check("petra: stats", stats.dataRows === 5 && stats.parsed === 5 && stats.skipped === 0,
    JSON.stringify(stats));
  check("petra: missing UPC counted (NONE + blank)", stats.missingUpc === 2,
    `got ${stats.missingUpc}`);

  const first = offers[0];
  check("petra: first sku", first.supplierSku === "3PLSCALLIEBK", first.supplierSku);
  check("petra: supplier pinned", first.supplier === "petra");
  check("petra: cost", first.costPrice === 48.99, `got ${first.costPrice}`);
  check("petra: upc digits", first.upc === "854635006513", `got ${first.upc}`);
  check("petra: qty", first.qtyAvailable === 51, `got ${first.qtyAvailable}`);
  check("petra: map", first.mapPrice === 59.99, `got ${first.mapPrice}`);
  check("petra: weight from ESTIMATED SHIP WEIGHT", near(first.weightLb, 0.72, 0.0001),
    `got ${first.weightLb}`);
  check("petra: image url", (first.imageUrl ?? "").includes("3PLSCALLIEBK.jpg"));
  check("petra: brand cleaned", first.brand === "3PLUS(R)", `got ${first.brand}`);
  check("petra: title is DESCRIPTION", first.title === "VIBE CLIE SMWCH W/BT CALL", first.title);
  const noneRow = offers.find((o) => o.supplierSku === "BRA6202");
  check("petra: 'NONE' UPC row kept, upc null", !!noneRow && noneRow.upc === null);
  const blankRow = offers.find((o) => o.supplierSku === "MT10204");
  check("petra: blank UPC row kept, upc null", !!blankRow && blankRow.upc === null);
}

// --- parsePetraCsv failure modes --------------------------------------------
{
  const bad = parsePetraCsv("some,random\nfile,here\n");
  check("petra: missing header → error, no offers",
    bad.offers.length === 0 && bad.errors.length === 1);
  const noRows = parsePetraCsv('"VENDOR SKU","PETRA SKU","PRICE"\n');
  check("petra: header only → zero offers, no crash",
    noRows.offers.length === 0 && noRows.stats.dataRows === 0);
}

// --- coerceSupplierOffer ------------------------------------------------------
{
  const ok = coerceSupplierOffer({
    supplierSku: "ABC123",
    vendorSku: "V-1",
    title: "Widget",
    costPrice: 12.5,
    qtyAvailable: 7.9,
    upc: "012345678905",
    supplier: "someone-else",
  });
  check("coerce: valid offer", !!ok && ok.supplierSku === "ABC123" && ok.costPrice === 12.5);
  check("coerce: supplier pinned to petra", ok?.supplier === "petra");
  check("coerce: qty truncated", ok?.qtyAvailable === 7);
  check("coerce: missing sku → null", coerceSupplierOffer({ costPrice: 5 }) === null);
  check("coerce: zero cost → null", coerceSupplierOffer({ supplierSku: "X", costPrice: 0 }) === null);
  check("coerce: junk → null", coerceSupplierOffer("nope") === null && coerceSupplierOffer(null) === null);
  check("coerce: 'NONE' upc → null", coerceSupplierOffer({ supplierSku: "X", costPrice: 1, upc: "NONE" })?.upc === null);
}

// --- estimateSupplierNet ------------------------------------------------------
// amazon 100, cost 50, default referral 15%, FBA band(100) = 7.00,
// prep 1.50 + inbound 0.45 + storage 0.35 → net 25.70, margin 25.7%.
{
  check("fees: prep constant", SUPPLIER_PREP_PER_UNIT === 1.5);
  const est = estimateSupplierNet({ costPrice: 50, productClass: "Outdoor & Fitness" }, 100);
  check("estimate: exists", !!est);
  check("estimate: net", near(est?.net, 25.7), `got ${est?.net}`);
  check("estimate: margin pct", near(est?.marginPct, 25.7, 0.11), `got ${est?.marginPct}`);
  check("estimate: referral fee", near(est?.referralFee, 15), `got ${est?.referralFee}`);
  check("estimate: fba fee band", near(est?.fbaFee, 7.0), `got ${est?.fbaFee}`);
  check("estimate: flagged as estimate", est?.estimated === true);

  const elec = estimateSupplierNet({ costPrice: 50, productClass: "electronics" }, 100);
  check("estimate: electronics referral 8%", near(elec?.net, 32.7), `got ${elec?.net}`);

  const override = estimateSupplierNet({ costPrice: 50 }, 100, { referralPct: 0.1, fbaFee: 5 });
  check("estimate: overrides honored", near(override?.net, 32.7), `got ${override?.net}`);

  check("estimate: unknown amazon price → null",
    estimateSupplierNet({ costPrice: 50 }, 0) === null &&
    estimateSupplierNet({ costPrice: 50 }, NaN) === null);
  check("estimate: bad cost → null", estimateSupplierNet({ costPrice: 0 }, 100) === null);

  const loser = estimateSupplierNet({ costPrice: 95 }, 100);
  check("estimate: negative net preserved", typeof loser?.net === "number" && loser.net < 0,
    `got ${loser?.net}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
