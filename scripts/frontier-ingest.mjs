#!/usr/bin/env node
// Frontier Co-op supplier-ingest helper (NexArb supplier platform).
//
// Frontier has no API and no portal CSV: its catalog is published monthly
// as XLSX files on its public CDN (wholesale.frontiercoop.com/data-feeds/)
// — an Annual Catalog (~9,350 SKUs) and a Current Prices specials file
// (~2,360 SKUs). This script reads the XLSX with a small built-in zip/XML
// reader (no dependencies, so it runs anywhere node does), normalizes
// rows via logic mirroring lib/suppliers/frontierCore.ts, and posts them
// to the app with the personal API key — same pattern as petra-ingest.mjs.
//
//   node scripts/frontier-ingest.mjs <catalog.xlsx> [more.xlsx ...]
//       [--no-match] [--no-scan] [--match-limit 50] [--scan-cap 100]
//       [--base-url https://app.nexarb.io] [--dry-run]
//
// Run the Annual Catalog first, then the Current Prices file: both upsert
// by (supplier, Item Number), so the specials file overlays current
// pricing on the full catalog. Monthly refresh = download the new files
// and re-run; matched ASINs and stored estimates survive re-ingest.
// --dry-run parses and prints stats without posting anything.
// Key: NEXARB_API_KEY env, else ~/workspace/nexarb/api-key.txt.
// INGEST ONLY — this never orders or spends money.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Minimal XLSX reader: an .xlsx is a zip of XML parts. This implements
// just enough ZIP (stored + deflate entries) and just enough sheet XML
// (shared strings, inline strings, formula-string and numeric cells) to
// turn the first worksheet into an array of row arrays. It is a local
// tool for two known-publisher files, not a general spreadsheet library.
// ---------------------------------------------------------------------------

function readZipEntries(buf) {
  // End Of Central Directory: scan the tail for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip central directory.");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // Local header: skip its own name/extra to reach the data.
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function xmlUnescape(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const parts = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1])) !== null) parts.push(xmlUnescape(t[1]));
    strings.push(parts.join(""));
  }
  return strings;
}

function firstSheetPath(entries) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const sheetMatch = /<sheet[^>]*r:id="([^"]+)"/.exec(workbook);
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  if (sheetMatch) {
    const relRe = new RegExp(`<Relationship[^>]*Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`);
    const rel = relRe.exec(rels);
    if (rel) {
      const target = rel[1].replace(/^\//, "");
      return target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
    }
  }
  // Fallback: the conventional first-sheet location.
  return "xl/worksheets/sheet1.xml";
}

const colIndexFromRef = (ref) => {
  const letters = /^[A-Z]+/.exec(ref ?? "")?.[0] ?? "";
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
};

function parseSheetRows(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const body = rm[1] ?? "";
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let nextCol = 0;
    while ((cm = cellRe.exec(body)) !== null) {
      const attrs = cm[1];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const colIdx = ref ? colIndexFromRef(ref) : nextCol;
      nextCol = colIdx + 1;
      const inner = cm[2] ?? "";
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let value = null;
      if (type === "s" && vMatch) {
        value = shared[Number(vMatch[1])] ?? null;
      } else if (type === "inlineStr") {
        const parts = [];
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(inner)) !== null) parts.push(xmlUnescape(t[1]));
        value = parts.join("");
      } else if (vMatch) {
        const raw = xmlUnescape(vMatch[1]);
        if (type === "str" || type === "b" || type === "e") value = raw;
        else {
          const n = Number(raw);
          value = Number.isFinite(n) ? n : raw;
        }
      }
      while (cells.length < colIdx) cells.push(null);
      cells[colIdx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** XLSX buffer → row objects keyed by the detected header row's names. */
function xlsxToRowObjects(buf) {
  const entries = readZipEntries(buf);
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const sheetPath = firstSheetPath(entries);
  const sheetXml = entries.get(sheetPath)?.toString("utf8");
  if (!sheetXml) throw new Error(`Worksheet part ${sheetPath} not found in xlsx.`);
  const rows = parseSheetRows(sheetXml, shared);
  // Header row: the first row that has a "UPC" cell and a price cell —
  // row 1 for Current Prices, row 3 for the Annual Catalog (title rows
  // precede it). Header names are trimmed; blank header cells are skipped.
  const hIdx = rows.findIndex((r) => {
    const cells = r.map((c) => (typeof c === "string" ? c.trim() : c));
    return cells.includes("UPC") && (cells.includes("Whls Price") || cells.includes("Wholesale Price"));
  });
  if (hIdx < 0) throw new Error("Frontier header row (UPC + price column) not found — is this a Frontier catalog file?");
  const header = rows[hIdx].map((c) => (typeof c === "string" ? c.trim() : ""));
  const objects = [];
  for (const r of rows.slice(hIdx + 1)) {
    const obj = {};
    header.forEach((h, i) => { if (h) obj[h] = r[i] ?? null; });
    objects.push(obj);
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Normalization — mirrors lib/suppliers/frontierCore.ts (parseFrontierRows
// + helpers). The TS core can't run in plain node without the repo's
// strip-types loader, so the small parse is duplicated here on purpose;
// keep the two in sync when the feed format changes. See frontierCore.ts
// for the evidence behind the price basis: PER-UNIT prices (portal
// "Your Price" $27.74 for Item 19852 == the file's Whls Price at Case
// Count 6) and Sales Price as the Current Prices cost basis.
// ---------------------------------------------------------------------------

const toText = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return t ? t : null;
};
const toNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const normalizeUpc = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) v = String(Math.trunc(v));
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  return d.length === 12 || d.length === 13 || d.length === 14 ? d : null;
};

function parseFrontierRows(rows) {
  const first = rows.find((r) => r && typeof r === "object") ?? {};
  const layout = "Whls Price" in first ? "annual" : "Wholesale Price" in first ? "current" : null;
  if (!layout) throw new Error("Frontier layout not recognized (no 'Whls Price' / 'Wholesale Price' column).");
  const offersBySku = new Map();
  let dataRows = 0, skipped = 0, missingUpc = 0, duplicatesCollapsed = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (Object.values(r).every((v) => v === null || v === undefined || v === "")) continue;
    dataRows++;
    const supplierSku = toText(r["Item Number"]);
    const costPrice = layout === "annual"
      ? toNumber(r["Whls Price"])
      : toNumber(r["Sales Price"]) ?? toNumber(r["Wholesale Price"]);
    if (!supplierSku || costPrice === null || costPrice <= 0) { skipped++; continue; }
    const upc = normalizeUpc(r["UPC"]);
    if (!upc) missingUpc++;
    let weightLb = toNumber(r["GrossWeight (lbs)"]);
    if (weightLb === null) {
      const label = toNumber(r["Label Weight"]);
      const uom = (toText(r["Label Weight UOM"]) ?? "").toUpperCase();
      if (label !== null && (uom === "LB" || uom === "LBS")) weightLb = label;
      else if (label !== null && (uom === "OZ" || uom === "OZS")) weightLb = label / 16;
    }
    const title = layout === "annual"
      ? toText(r["Long Product Name"]) ?? toText(r["Catalog Name"])
      : toText(r["Description"]);
    const offer = {
      supplier: "frontier",
      supplierSku,
      vendorSku: null,
      title: title ?? supplierSku,
      brand: toText(r["Brand"]),
      upc,
      costPrice,
      mapPrice: null,
      msrp: layout === "annual" ? toNumber(r["SRP"]) : null,
      qtyAvailable: 0, // files carry no stock counts — 0 = unknown for Frontier
      imageUrl: null,
      productClass: null,
      subcategory: null,
      weightLb,
      originCountry: null,
    };
    const existing = offersBySku.get(supplierSku);
    if (!existing) offersBySku.set(supplierSku, offer);
    else {
      duplicatesCollapsed++;
      if (costPrice < existing.costPrice) offersBySku.set(supplierSku, offer);
    }
  }
  return {
    offers: [...offersBySku.values()],
    stats: { dataRows, parsed: offersBySku.size, skipped, missingUpc, duplicatesCollapsed },
    layout,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== argValue("--base-url", "") && a !== argValue("--match-limit", "") && a !== argValue("--scan-cap", ""));
  if (files.length === 0) {
    console.error("Usage: node scripts/frontier-ingest.mjs <catalog.xlsx> [more.xlsx ...] [--no-match] [--no-scan] [--dry-run]");
    process.exit(2);
  }
  const baseUrl = (argValue("--base-url", process.env.NEXARB_APP_URL || "https://app.nexarb.io")).replace(/\/$/, "");
  const matchLimit = Number(argValue("--match-limit", "50")) || 50;
  const scanCap = Number(argValue("--scan-cap", "100")) || 100;
  const doMatch = !process.argv.includes("--no-match");
  const doScan = !process.argv.includes("--no-scan");
  const dryRun = process.argv.includes("--dry-run");

  const allOffers = [];
  for (const file of files) {
    const { offers, stats, layout } = parseFrontierRows(xlsxToRowObjects(readFileSync(file)));
    console.log(`${file}: layout=${layout}, parsed ${stats.parsed} offers ` +
      `(rows ${stats.dataRows}, skipped ${stats.skipped}, missing/invalid UPC ${stats.missingUpc}, dup SKUs collapsed ${stats.duplicatesCollapsed})`);
    allOffers.push(...offers);
  }
  if (dryRun) {
    console.log(`Dry run: ${allOffers.length} offers parsed, nothing posted.`);
    return;
  }

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

  const BATCH = 250;
  let inserted = 0, updated = 0;
  for (let i = 0; i < allOffers.length; i += BATCH) {
    const batch = allOffers.slice(i, i + BATCH);
    const r = await post("/api/sourcing/frontier", { offers: batch, sourceFileDate: null });
    inserted += r.inserted ?? 0;
    updated += r.updated ?? 0;
    console.log(`  batch ${i / BATCH + 1}: received ${r.received}, inserted ${r.inserted}, updated ${r.updated}` +
      (r.errors?.length ? ` — errors: ${r.errors.join("; ")}` : ""));
  }
  console.log(`Ingest complete: ${inserted} inserted, ${updated} updated.`);

  if (doMatch) {
    for (let round = 1; round <= 40; round++) {
      const r = await post("/api/sourcing/frontier/match", { limit: matchLimit });
      console.log(`Match round ${round}: processed ${r.processed}, matched ${r.matched}, no-match ${r.noMatch}, errors ${r.errored}`);
      if (!r.processed) break;
    }
  }
  if (doScan) {
    for (let round = 1; round <= 20; round++) {
      const r = await post("/api/sourcing/frontier/scan", { cap: scanCap });
      console.log(`Scan round ${round}: processed ${r.processed}, priced ${r.priced}, skipped ${r.skipped}`);
      if (!r.processed) break;
    }
  }
  console.log("Done. View results at /dashboard/suppliers (supplier: Frontier Co-op).");
}

main().catch((e) => {
  console.error(`frontier-ingest failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
