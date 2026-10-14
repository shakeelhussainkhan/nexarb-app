// Pure core for Frontier Co-op supplier-offer ingestion (NexArb supplier
// platform: Frontier adapter on the Phase 1 pipeline — data + matching +
// margin view; NO ordering anywhere).
//
// Frontier has no API and no portal CSV: the catalog arrives as monthly
// XLSX files published on Frontier's public CDN (wholesale.frontiercoop.com
// /data-feeds/): the full Annual Catalog (~9,350 SKUs) and a smaller
// Current Prices specials file (~2,360 SKUs, a discounted subset). The
// ingest script (scripts/frontier-ingest.mjs) reads the XLSX and hands
// this module row OBJECTS keyed by the sheet's header names; this module
// is pure (no IO) so the offline harness (scripts/verify-frontier.mjs)
// can drive it against fixtures excerpted from the real files.
//
// The two sheet layouts:
//   annual  — header row 3 ("UPC", "Item Number", "Catalog Name", a blank
//             column, "Long Product Name", "Case Count", "Label Weight",
//             "Label Weight UOM", "Whls Price", "SRP", "Brand", "Status",
//             ..., "GrossWeight (lbs)")
//   current — header row 1, same family minus SRP, with "Wholesale Price"
//             AND a "Sales Price" that is lower than Wholesale on every
//             row of the real file (2,356/2,356) — i.e. the effective
//             current transaction price, so it is the cost basis below.
//
// PRICE BASIS — PER UNIT, verified 2026-10-14 against the live portal:
// Simply Organic Pure Madagascar Vanilla Extract 8 fl oz, Item 19852,
// UPC 0-89836-19852-5, Case Count 6: the Annual file's Whls Price is
// 27.74 and the member portal shows "Your Price" $27.74 for ONE unit —
// the file price is per unit, NOT per case, so Case Count is never a
// divisor. (Per-case would price an 8 oz vanilla extract with SRP $39.99
// at $4.62/unit.) The 2 fl oz / 4 fl oz siblings (8.83 / 15.35 at the
// same case count) scale per-unit consistently.
//
// STOCK: the files carry no on-hand counts, so qtyAvailable is 0 with
// stock UNKNOWN (never presented as real availability — the Suppliers
// page renders "—" for Frontier). Match/pricing passes do not use qty.

import type { SupplierOffer } from "./petraCore";

export const FRONTIER_SUPPLIER = "frontier";

export interface FrontierParseResult {
  offers: SupplierOffer[];
  stats: {
    dataRows: number;
    parsed: number;
    skipped: number;
    missingUpc: number;
    /** Rows collapsed because the SKU appeared more than once (see below). */
    duplicatesCollapsed: number;
  };
  errors: string[];
}

export type FrontierLayout = "annual" | "current";

/** One spreadsheet row keyed by header name; xlsx cells are typed. */
export type FrontierRowObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Value helpers — spreadsheet cells arrive as numbers OR strings, so these
// accept `unknown` (petraCore's versions are CSV-string-only).
// ---------------------------------------------------------------------------

function toText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return t ? t : null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * UPC normalize: strip hyphens/spaces, digits only, accept 12/13/14
 * (UPC-A / EAN-13 / GTIN-14 — the lengths Frontier actually publishes).
 * Anything else (blanks, the 11-digit values whose leading zero was lost
 * upstream, short internal codes) → null: unusable for catalog matching,
 * and a wrong guess is worse than no UPC.
 */
export function normalizeFrontierUpc(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(Math.trunc(v));
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D/g, "");
  return digits.length === 12 || digits.length === 13 || digits.length === 14
    ? digits
    : null;
}

/**
 * Detect which Frontier sheet layout a row-object set uses, from its
 * first row's keys: the annual catalog prices via "Whls Price"; the
 * current-prices file via "Wholesale Price". Null when neither fits.
 */
export function detectFrontierLayout(
  rows: FrontierRowObject[]
): FrontierLayout | null {
  const first = rows.find((r) => r && typeof r === "object");
  if (!first) return null;
  if ("Whls Price" in first) return "annual";
  if ("Wholesale Price" in first) return "current";
  return null;
}

// ---------------------------------------------------------------------------
// Frontier row objects → normalized offers (the petraCore SupplierOffer
// shape, supplier pinned to "frontier").
// ---------------------------------------------------------------------------

export function parseFrontierRows(
  rows: FrontierRowObject[],
  layoutHint?: FrontierLayout
): FrontierParseResult {
  const errors: string[] = [];
  const layout = layoutHint ?? detectFrontierLayout(rows);
  if (!layout) {
    return {
      offers: [],
      stats: { dataRows: 0, parsed: 0, skipped: 0, missingUpc: 0, duplicatesCollapsed: 0 },
      errors: [
        "Frontier layout not recognized — expected a 'Whls Price' (annual catalog) or 'Wholesale Price' (current prices) column.",
      ],
    };
  }

  const offers: SupplierOffer[] = [];
  const offerIndexBySku = new Map<string, number>();
  let dataRows = 0;
  let skipped = 0;
  let missingUpc = 0;
  let duplicatesCollapsed = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    // Skip fully blank rows (spacer rows exist in the annual file).
    if (Object.values(r).every((v) => v === null || v === undefined || v === "")) continue;
    dataRows++;
    const supplierSku = toText(r["Item Number"]);
    // Cost basis: annual = Whls Price; current = Sales Price (the
    // effective current price — always present and always below the list
    // Wholesale Price in the real file), falling back to Wholesale Price.
    const costPrice =
      layout === "annual"
        ? toNumber(r["Whls Price"])
        : toNumber(r["Sales Price"]) ?? toNumber(r["Wholesale Price"]);
    if (!supplierSku || costPrice === null || costPrice <= 0) {
      skipped++;
      continue;
    }
    const upc = normalizeFrontierUpc(r["UPC"]);
    if (!upc) missingUpc++;

    // Weight: GrossWeight (lbs) is populated for every real row. The
    // fallback is Label Weight — but that is the product's labeled size,
    // so it only converts when its UOM is a weight (LB as-is, OZ / 16);
    // fluid ounces / counts are not weights and stay null.
    let weightLb = toNumber(r["GrossWeight (lbs)"]);
    if (weightLb === null) {
      const label = toNumber(r["Label Weight"]);
      const uom = (toText(r["Label Weight UOM"]) ?? "").toUpperCase();
      if (label !== null && (uom === "LB" || uom === "LBS")) weightLb = label;
      else if (label !== null && (uom === "OZ" || uom === "OZS")) weightLb = label / 16;
    }

    const title =
      layout === "annual"
        ? toText(r["Long Product Name"]) ?? toText(r["Catalog Name"])
        : toText(r["Description"]);

    const offer: SupplierOffer = {
      supplier: FRONTIER_SUPPLIER,
      supplierSku,
      vendorSku: null, // Frontier publishes no second SKU.
      title: title ?? supplierSku,
      brand: toText(r["Brand"]),
      upc,
      costPrice,
      mapPrice: null, // No MAP column in either file.
      msrp: layout === "annual" ? toNumber(r["SRP"]) : null,
      // No stock counts in the files — 0 means UNKNOWN for this supplier,
      // never a claim of availability (see header note).
      qtyAvailable: 0,
      imageUrl: null, // The files carry no image URLs.
      productClass: null,
      subcategory: null,
      weightLb,
      originCountry: null,
    };
    // The Current Prices file lists some SKUs twice with two different
    // Sales Prices (stacked promo tiers — same item, same UPC). Keep the
    // LOWEST cost per SKU: it is the best current price the file offers,
    // and one row per (supplier, sku) is what the ingest upsert requires.
    const existingIdx = offerIndexBySku.get(supplierSku);
    if (existingIdx === undefined) {
      offerIndexBySku.set(supplierSku, offers.length);
      offers.push(offer);
    } else {
      duplicatesCollapsed++;
      if (costPrice < offers[existingIdx].costPrice) {
        offers[existingIdx] = offer;
      }
    }
  }

  return {
    offers,
    stats: {
      dataRows,
      parsed: offers.length,
      skipped,
      missingUpc,
      duplicatesCollapsed,
    },
    errors,
  };
}
