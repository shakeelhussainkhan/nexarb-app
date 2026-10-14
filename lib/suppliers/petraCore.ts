// Pure core for Petra supplier-offer ingestion (NexArb Phase 1: supplier
// catalog ingestion — data + matching + margin view; NO ordering anywhere).
//
// Petra has no API: the catalog arrives as the portal's "prodlist.csv"
// product-list download. File shape (verified against the real 2026-10-14
// export): two preamble lines ("All Products with Quantity on Hand" and a
// "Generated","MM-DD-YYYY",... line), then a quoted header row whose first
// cell is "VENDOR SKU", then one quoted row per product. 99.7% of rows
// carry a UPC — the opposite of retailer-page scraping — which is what
// makes supplier matching reliable.
//
// This module is pure (no IO, no Supabase, no network) so the offline
// harness (scripts/verify-suppliers.mjs) can drive it against a fixture
// excerpted from the real feed. Server wiring lives in lib/suppliers/petra.ts.

import {
  estimateFbaFee,
  outcomeAtPrice,
  referralPctForCategory,
} from "@/lib/engine/pricing";

// ---------------------------------------------------------------------------
// Normalized offer — mirrors the supplier_offers columns written at ingest.
// ---------------------------------------------------------------------------

export interface SupplierOffer {
  supplier: string; // "petra"
  supplierSku: string; // PETRA SKU (unique per supplier)
  vendorSku: string | null;
  title: string;
  brand: string | null;
  upc: string | null; // digits only, 8/12/13/14 long; null when absent/"NONE"
  costPrice: number; // wholesale PRICE from the feed
  mapPrice: number | null;
  msrp: number | null;
  qtyAvailable: number;
  imageUrl: string | null;
  productClass: string | null;
  subcategory: string | null;
  weightLb: number | null; // ESTIMATED SHIP WEIGHT, fallback WEIGHT-UNPACKED
  originCountry: string | null;
}

export interface PetraParseResult {
  offers: SupplierOffer[];
  /** ISO date (YYYY-MM-DD) from the "Generated" preamble line, when present. */
  sourceFileDate: string | null;
  stats: {
    dataRows: number;
    parsed: number;
    skipped: number;
    missingUpc: number;
  };
  errors: string[];
}

// ---------------------------------------------------------------------------
// Minimal RFC-4180 CSV parser: quoted fields, "" escapes, commas and
// newlines inside quotes, CRLF or LF row endings. Never throws.
// ---------------------------------------------------------------------------

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = (text ?? "").replace(/^\uFEFF/, ""); // strip BOM
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or lone CR: end the row, swallow a following LF.
      pushRow();
      i += src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Trailing field/row when the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Field normalization helpers.
// ---------------------------------------------------------------------------

/** Collapse NBSP/whitespace; empty → null. */
function cleanText(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  return t ? t : null;
}

/** Tolerant number parse: strips $, commas, spaces; blank/junk → null. */
function parseNumber(v: string | undefined): number | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * UPC normalize, same acceptance rule as the discovery matcher
 * (lib/sourcing/match.ts): digits only, length 8/12/13/14. The feed uses
 * the literal "NONE" (and blanks) for products without a UPC → null.
 */
function normalizeFeedUpc(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D/g, "");
  return digits.length === 8 ||
    digits.length === 12 ||
    digits.length === 13 ||
    digits.length === 14
    ? digits
    : null;
}

/** "10-14-2026" (MM-DD-YYYY) → "2026-10-14"; invalid → null. */
function parseGeneratedDate(v: string | undefined): string | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec((v ?? "").trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Petra prodlist.csv → normalized offers.
// ---------------------------------------------------------------------------

export function parsePetraCsv(text: string): PetraParseResult {
  const errors: string[] = [];
  const rows = parseCsvRows(text);

  // Extract the generated date from the preamble when present.
  let sourceFileDate: string | null = null;
  for (const r of rows.slice(0, 5)) {
    if ((r[0] ?? "").trim().toLowerCase() === "generated") {
      sourceFileDate = parseGeneratedDate(r[1]);
      if (sourceFileDate) break;
    }
  }

  // The header row is the first row whose first cell is "VENDOR SKU".
  const headerIdx = rows.findIndex(
    (r) => (r[0] ?? "").replace(/\u00A0/g, " ").trim().toUpperCase() === "VENDOR SKU"
  );
  if (headerIdx < 0) {
    return {
      offers: [],
      sourceFileDate,
      stats: { dataRows: 0, parsed: 0, skipped: 0, missingUpc: 0 },
      errors: ["Petra CSV header row (first cell 'VENDOR SKU') not found — is this a prodlist.csv export?"],
    };
  }
  const header = rows[headerIdx].map((h) => h.replace(/\u00A0/g, " ").trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    vendorSku: col("VENDOR SKU"),
    petraSku: col("PETRA SKU"),
    description: col("DESCRIPTION"),
    available: col("AVAILABLE"),
    price: col("PRICE"),
    brand: col("BRAND NAME"),
    weightUnpacked: col("WEIGHT-UNPACKED"),
    productClass: col("PRODUCT CLASS"),
    upc: col("UPC"),
    longDesc: col("LONG DESC"),
    subcategory: col("SUBCATEGORY"),
    map: col("MAP"),
    shipWeight: col("ESTIMATED SHIP WEIGHT"),
    msrp: col("MSRP"),
    imageUrl: col("IMAGE URL"),
    origin: col("ORIGIN COUNTRY"),
  };
  if (idx.petraSku < 0 || idx.price < 0) {
    return {
      offers: [],
      sourceFileDate,
      stats: { dataRows: 0, parsed: 0, skipped: 0, missingUpc: 0 },
      errors: ["Petra CSV is missing required PETRA SKU / PRICE columns."],
    };
  }

  const offers: SupplierOffer[] = [];
  let dataRows = 0;
  let skipped = 0;
  let missingUpc = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    // Skip fully blank trailing lines.
    if (r.every((c) => !(c ?? "").trim())) continue;
    dataRows++;
    const get = (i: number) => (i >= 0 ? r[i] : undefined);
    const supplierSku = cleanText(get(idx.petraSku));
    const costPrice = parseNumber(get(idx.price));
    if (!supplierSku || costPrice === null || costPrice <= 0) {
      skipped++;
      continue;
    }
    const upc = normalizeFeedUpc(get(idx.upc));
    if (!upc) missingUpc++;
    const qtyRaw = parseNumber(get(idx.available));
    const shipWeight = parseNumber(get(idx.shipWeight));
    const unpackedWeight = parseNumber(get(idx.weightUnpacked));
    const description = cleanText(get(idx.description));
    const longDesc = cleanText(get(idx.longDesc));
    offers.push({
      supplier: "petra",
      supplierSku,
      vendorSku: cleanText(get(idx.vendorSku)),
      title: description ?? (longDesc ? longDesc.slice(0, 160) : supplierSku),
      brand: cleanText(get(idx.brand)),
      upc,
      costPrice,
      mapPrice: parseNumber(get(idx.map)),
      msrp: parseNumber(get(idx.msrp)),
      qtyAvailable: qtyRaw === null ? 0 : Math.max(0, Math.trunc(qtyRaw)),
      imageUrl: cleanText(get(idx.imageUrl)),
      productClass: cleanText(get(idx.productClass)),
      subcategory: cleanText(get(idx.subcategory)),
      weightLb: shipWeight ?? unpackedWeight,
      originCountry: cleanText(get(idx.origin)),
    });
  }

  return {
    offers,
    sourceFileDate,
    stats: { dataRows, parsed: offers.length, skipped, missingUpc },
    errors,
  };
}

/**
 * Coerce one untrusted JSON object (the ingest routes' body shape — the
 * parsers' output shape) into a SupplierOffer, or null when it lacks the
 * minimum viable fields (SKU + a positive cost). The supplier is pinned
 * server-side to the route's own supplier (default "petra"; the Frontier
 * route passes "frontier") — a body can never smuggle in another supplier.
 */
export function coerceSupplierOffer(raw: unknown, supplier: string = "petra"): SupplierOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const supplierSku = str(r.supplierSku);
  const costPrice = num(r.costPrice);
  if (!supplierSku || costPrice === null || costPrice <= 0) return null;
  const qty = num(r.qtyAvailable);
  return {
    supplier,
    supplierSku,
    vendorSku: str(r.vendorSku),
    title: str(r.title) ?? supplierSku,
    brand: str(r.brand),
    upc: normalizeFeedUpc(typeof r.upc === "string" ? r.upc : undefined),
    costPrice,
    mapPrice: num(r.mapPrice),
    msrp: num(r.msrp),
    qtyAvailable: qty === null ? 0 : Math.max(0, Math.trunc(qty)),
    imageUrl: str(r.imageUrl),
    productClass: str(r.productClass),
    subcategory: str(r.subcategory),
    weightLb: num(r.weightLb),
    originCountry: str(r.originCountry),
  };
}

// ---------------------------------------------------------------------------
// Margin estimate — the same fee stack the deal engine uses
// (lib/engine/pricing.ts: outcomeAtPrice with the 3PL prep rate, inbound and
// storage defaults, band-estimated FBA fee, category referral %). Every
// output is an ESTIMATE until per-ASIN SP-API fee data is wired in; callers
// must label it as such.
// ---------------------------------------------------------------------------

/** Automated 3PL starter prep rate (receiving/inspection/FNSKU/poly-bag). */
export const SUPPLIER_PREP_PER_UNIT = 1.5;
/** Prep-center → FBA inbound shipping per unit (engine default). */
export const SUPPLIER_INBOUND_PER_UNIT = 0.45;
/** Expected storage over the holding window (engine default). */
export const SUPPLIER_STORAGE_PER_UNIT = 0.35;

export interface SupplierNetEstimate {
  /** Estimated net profit per unit in USD (2dp). */
  net: number;
  /** Estimated margin as a PERCENT of the Amazon price (1dp), e.g. 22.2. */
  marginPct: number;
  referralFee: number;
  fbaFee: number;
  prepFee: number;
  inboundFee: number;
  storageFee: number;
  /** Always true — these figures are estimates, never exact fees. */
  estimated: true;
}

export interface SupplierFeeOverrides {
  referralPct?: number; // fraction, e.g. 0.15
  fbaFee?: number; // USD
}

/**
 * Estimate the per-unit economics of buying one unit from the supplier at
 * its feed cost and selling it on Amazon at `amazonPrice`:
 *   net = amazonPrice − (cost + $1.50 prep + inbound + storage
 *                        + referral % + estimated FBA fee)
 * Returns null when either price is unusable (unknown is not zero).
 */
export function estimateSupplierNet(
  offer: { costPrice: number; productClass?: string | null; subcategory?: string | null },
  amazonPrice: number,
  feeEstimates?: SupplierFeeOverrides
): SupplierNetEstimate | null {
  if (!Number.isFinite(amazonPrice) || amazonPrice <= 0) return null;
  if (!Number.isFinite(offer.costPrice) || offer.costPrice <= 0) return null;
  const referralPct =
    feeEstimates?.referralPct ??
    referralPctForCategory(offer.productClass ?? offer.subcategory ?? undefined);
  const fbaFee = feeEstimates?.fbaFee ?? estimateFbaFee(amazonPrice);
  const outcome = outcomeAtPrice(amazonPrice, {
    buyCost: offer.costPrice,
    prepPerUnit: SUPPLIER_PREP_PER_UNIT,
    inboundPerUnit: SUPPLIER_INBOUND_PER_UNIT,
    storagePerUnit: SUPPLIER_STORAGE_PER_UNIT,
    fbaFee,
    referralPct,
  });
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    net: round2(outcome.netProfit),
    marginPct: Math.round(outcome.marginPct * 1000) / 10,
    referralFee: round2(referralPct * amazonPrice),
    fbaFee: round2(fbaFee),
    prepFee: SUPPLIER_PREP_PER_UNIT,
    inboundFee: SUPPLIER_INBOUND_PER_UNIT,
    storageFee: SUPPLIER_STORAGE_PER_UNIT,
    estimated: true,
  };
}
