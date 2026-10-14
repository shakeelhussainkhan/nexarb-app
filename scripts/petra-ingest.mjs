#!/usr/bin/env node
// Petra supplier-ingest helper (NexArb Phase 1).
//
// Mirrors the discovery-sweep pattern: the Petra portal has no API, so a
// browser session downloads prodlist.csv from the portal (Product List
// Download), and THIS script does the server-side ingest with the personal
// API key — the browser is never the app credential.
//
//   node scripts/petra-ingest.mjs <path-to-prodlist.csv> [--no-match] [--no-scan]
//                                       [--match-limit 50] [--scan-cap 100]
//                                       [--base-url https://app.nexarb.io]
//
// Flow: parse CSV → POST /api/sourcing/petra in batches of 250 →
//       POST /api/sourcing/petra/match until no pending rows remain
//       (bounded rounds) → POST /api/sourcing/petra/scan likewise.
// Key: NEXARB_API_KEY env, else ~/workspace/nexarb/api-key.txt.
// INGEST ONLY — this never orders or spends money.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Minimal standalone CSV parse — mirrors lib/suppliers/petraCore.ts
// (parseCsvRows + parsePetraCsv). The TS core can't run in plain node
// without the repo's strip-types loader, so the small parse is duplicated
// here on purpose; keep the two in sync when the feed format changes.
// ---------------------------------------------------------------------------

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  let i = 0;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { pushField(); i++; continue; }
    if (ch === "\r") { pushRow(); i += src[i + 1] === "\n" ? 2 : 1; continue; }
    if (ch === "\n") { pushRow(); i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

const cleanText = (v) => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  return t ? t : null;
};
const parseNumber = (v) => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const normalizeUpc = (v) => {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  return d.length === 8 || d.length === 12 || d.length === 13 || d.length === 14 ? d : null;
};

function parsePetraCsv(text) {
  const rows = parseCsvRows(text);
  let sourceFileDate = null;
  for (const r of rows.slice(0, 5)) {
    if ((r[0] ?? "").trim().toLowerCase() === "generated") {
      const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec((r[1] ?? "").trim());
      if (m) {
        sourceFileDate = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
        break;
      }
    }
  }
  const headerIdx = rows.findIndex(
    (r) => (r[0] ?? "").replace(/\u00A0/g, " ").trim().toUpperCase() === "VENDOR SKU"
  );
  if (headerIdx < 0) throw new Error("Petra CSV header row (first cell 'VENDOR SKU') not found.");
  const header = rows[headerIdx].map((h) => h.replace(/\u00A0/g, " ").trim().toUpperCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    vendorSku: col("VENDOR SKU"), petraSku: col("PETRA SKU"), description: col("DESCRIPTION"),
    available: col("AVAILABLE"), price: col("PRICE"), brand: col("BRAND NAME"),
    weightUnpacked: col("WEIGHT-UNPACKED"), productClass: col("PRODUCT CLASS"), upc: col("UPC"),
    longDesc: col("LONG DESC"), subcategory: col("SUBCATEGORY"), map: col("MAP"),
    shipWeight: col("ESTIMATED SHIP WEIGHT"), msrp: col("MSRP"), imageUrl: col("IMAGE URL"),
    origin: col("ORIGIN COUNTRY"),
  };
  const offers = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (r.every((c) => !(c ?? "").trim())) continue;
    const get = (i) => (i >= 0 ? r[i] : undefined);
    const supplierSku = cleanText(get(idx.petraSku));
    const costPrice = parseNumber(get(idx.price));
    if (!supplierSku || costPrice === null || costPrice <= 0) continue;
    const qtyRaw = parseNumber(get(idx.available));
    const description = cleanText(get(idx.description));
    const longDesc = cleanText(get(idx.longDesc));
    offers.push({
      supplier: "petra",
      supplierSku,
      vendorSku: cleanText(get(idx.vendorSku)),
      title: description ?? (longDesc ? longDesc.slice(0, 160) : supplierSku),
      brand: cleanText(get(idx.brand)),
      upc: normalizeUpc(get(idx.upc)),
      costPrice,
      mapPrice: parseNumber(get(idx.map)),
      msrp: parseNumber(get(idx.msrp)),
      qtyAvailable: qtyRaw === null ? 0 : Math.max(0, Math.trunc(qtyRaw)),
      imageUrl: cleanText(get(idx.imageUrl)),
      productClass: cleanText(get(idx.productClass)),
      subcategory: cleanText(get(idx.subcategory)),
      weightLb: parseNumber(get(idx.shipWeight)) ?? parseNumber(get(idx.weightUnpacked)),
      originCountry: cleanText(get(idx.origin)),
    });
  }
  return { offers, sourceFileDate };
}

/** Decode the feed: UTF-8 when valid, else windows-1252 (the portal's). */
function decodeFeed(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath || csvPath.startsWith("--")) {
    console.error("Usage: node scripts/petra-ingest.mjs <path-to-prodlist.csv> [--no-match] [--no-scan]");
    process.exit(2);
  }
  const baseUrl = (argValue("--base-url", process.env.NEXARB_APP_URL || "https://app.nexarb.io")).replace(/\/$/, "");
  const matchLimit = Number(argValue("--match-limit", "50")) || 50;
  const scanCap = Number(argValue("--scan-cap", "100")) || 100;
  const doMatch = !process.argv.includes("--no-match");
  const doScan = !process.argv.includes("--no-scan");

  const key =
    process.env.NEXARB_API_KEY ||
    readFileSync(join(homedir(), "workspace/nexarb/api-key.txt"), "utf8").trim();
  const headers = { "X-NexArb-Key": key, "Content-Type": "application/json" };
  const post = async (path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${json.error ?? "unknown error"}`);
    return json;
  };

  const { offers, sourceFileDate } = parsePetraCsv(decodeFeed(readFileSync(csvPath)));
  console.log(`Parsed ${offers.length} offers from ${csvPath} (feed date: ${sourceFileDate ?? "unknown"})`);

  const BATCH = 250;
  let inserted = 0, updated = 0;
  for (let i = 0; i < offers.length; i += BATCH) {
    const batch = offers.slice(i, i + BATCH);
    const r = await post("/api/sourcing/petra", { offers: batch, sourceFileDate });
    inserted += r.inserted ?? 0;
    updated += r.updated ?? 0;
    console.log(`  batch ${i / BATCH + 1}: received ${r.received}, inserted ${r.inserted}, updated ${r.updated}` +
      (r.errors?.length ? ` — errors: ${r.errors.join("; ")}` : ""));
  }
  console.log(`Ingest complete: ${inserted} inserted, ${updated} updated.`);

  if (doMatch) {
    for (let round = 1; round <= 20; round++) {
      const r = await post("/api/sourcing/petra/match", { limit: matchLimit });
      console.log(`Match round ${round}: processed ${r.processed}, matched ${r.matched}, no-match ${r.noMatch}, errors ${r.errored}`);
      if (!r.processed) break;
    }
  }
  if (doScan) {
    for (let round = 1; round <= 10; round++) {
      const r = await post("/api/sourcing/petra/scan", { cap: scanCap });
      console.log(`Scan round ${round}: processed ${r.processed}, priced ${r.priced}, skipped ${r.skipped}`);
      if (!r.processed) break;
    }
  }
  console.log("Done. View results at /dashboard/suppliers.");
}

main().catch((e) => {
  console.error(`petra-ingest failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
