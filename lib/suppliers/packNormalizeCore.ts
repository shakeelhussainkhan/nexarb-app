// Pure pack-normalization core for supplier offers (NexArb Phase 1.5
// fix): stop the pipeline from pairing a supplier's SINGLE-UNIT cost
// with an Amazon CASE-PACK price.
//
// THE DEFECT (verified 2026-10-16 by hand-vetting the top 5 Frontier
// candidates — every one was this exact mismatch):
//   Wicked Joe coffee 12 oz, cost $12.20/bag vs ASIN price $105.07 —
//   the listing is a PACK OF 6, so the unit price is $17.51 and the
//   true net is ≈ −$1.82, not the +$67.81 the evaluator reported.
// The UPC matcher is not wrong — the ASIN genuinely carries the
// product's UPC (distributors reuse one UPC across unit and case
// configurations; Simply Organic black pepper UPC 089836194954 is
// listed both ways). The LISTING's own pack declaration is the only
// trustworthy authority on what its price buys, so normalization keys
// off the listing title, never off UPC shape alone.
//
// WHAT THIS MODULE DECIDES (pure, no IO — the fee math itself stays in
// the evaluator's existing model, estimateSupplierNet + freight; this
// module only establishes the correct per-unit price basis):
//   1. detectListingPackQty — how many supplier units the Amazon
//      listing's price buys, from EXPLICIT declarations only.
//   2. supplierUpcKind — whether the supplier UPC itself is a
//      case-level GTIN-14 (feed unit definition untrustworthy).
//   3. normalizeEconomics / analyzeListingPack — the composition the
//      evaluator calls: a GTIN-14 supplier UPC yields status
//      "unverified_case_upc" and NO candidate-grade economics (the
//      UNREAL fixture: UPC/weight say "case of 6" while the $5.20
//      price is per-bag — the feed mixes levels, so no honest per-unit
//      number exists); otherwise the unit price is amazonPrice ÷
//      packQty and economics proceed on that basis.
//
// CONSERVATISM CONTRACT: packQty defaults to 1. Only explicit textual
// declarations move it ("Pack of 6", "Case of 12", "12-Pack",
// "120 Count", "6 x 12 oz"), or an explicit size division (a stated
// total size divided by a stated unit size). Vague titles ("Family
// Size", "Value Pack", "Multipack") NEVER move it — they yield
// packQty 1 with confidence "none", and the caller flags that as
// low-confidence rather than silently trusting the price.
//
// KNOWN LIMIT: count-style declarations are ambiguous for goods whose
// count is intrinsic to one retail unit ("120 Count" capsules are one
// bottle). The evidence string is always recorded in the eval reasons
// so every normalization is auditable by a human.

// ---------------------------------------------------------------------------
// Supplier UPC kind.
// ---------------------------------------------------------------------------

export type SupplierUpcKind = "each" | "case_gtin14" | "unknown";

/**
 * Classify a supplier UPC by shape:
 *   - 12-digit UPC-A / 13-digit EAN-13 / 8-digit UPC-E/EAN-8 → "each"
 *     (these are retail-unit identifiers).
 *   - 14-digit GTIN-14 with packaging indicator 1–8 → "case_gtin14"
 *     (the identifier denotes a case/trade unit, NOT the retail unit —
 *     economics built on it as if it were an each are untrustworthy).
 *   - 14-digit starting with 0 → a zero-padded UPC-A → "each".
 *   - anything else (or absent) → "unknown".
 */
export function supplierUpcKind(upc: string | null | undefined): SupplierUpcKind {
  if (typeof upc !== "string") return "unknown";
  const digits = upc.replace(/\D/g, "");
  if (digits.length === 8 || digits.length === 12 || digits.length === 13) {
    return "each";
  }
  if (digits.length === 14) {
    const indicator = digits.charCodeAt(0) - 48; // '0'..'9'
    if (indicator >= 1 && indicator <= 8) return "case_gtin14";
    if (indicator === 0) return "each";
    return "unknown";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Listing pack detection.
// ---------------------------------------------------------------------------

export type PackConfidence = "explicit" | "derived" | "none";

export interface PackDetection {
  /** Units the listing price buys; 1 unless an explicit declaration
   * (or an explicit size division) says otherwise. */
  packQty: number;
  confidence: PackConfidence;
  /** Human-readable audit trail, e.g. 'matched "Pack of 6"'. */
  evidence: string;
}

const MAX_SANE_PACK = 1000;

function sanePack(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= MAX_SANE_PACK ? n : null;
}

/** Explicit pack declarations, in a fixed pattern priority (not
 * document order): the most specific shapes win. */
const EXPLICIT_PATTERNS: Array<{ re: RegExp; label: (n: number) => string }> = [
  { re: /\bpack\s*of\s*(\d{1,4})\b/i, label: (n) => `Pack of ${n}` },
  { re: /\bcase\s*of\s*(\d{1,4})\b/i, label: (n) => `Case of ${n}` },
  { re: /\b(\d{1,4})\s*-\s*pack\b/i, label: (n) => `${n}-Pack` },
  { re: /\b(\d{1,4})\s+pack\b/i, label: (n) => `${n} Pack` },
  { re: /\b(\d{1,4})\s*-\s*count\b/i, label: (n) => `${n}-Count` },
  { re: /\b(\d{1,4})\s+count\b/i, label: (n) => `${n} Count` },
  { re: /\bcount\s*[:of]*\s*(\d{1,4})\b/i, label: (n) => `Count: ${n}` },
  // "6 x 12 oz" — an explicit multiplication of units × unit size.
  {
    re: /\b(\d{1,4})\s*[x×]\s*\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|lb|lbs|g|kg|ml|l)\b/i,
    label: (n) => `${n} x (unit size)`,
  },
];

const SIZE_RE =
  /(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid\s*ounces?|ounces?|oz|pounds?|lbs?|lb|grams?|g|kg|milliliters?|ml|liters?|l)\b/gi;

function sizeUnit(raw: string): string {
  const u = raw.toLowerCase().replace(/\s+/g, "");
  if (u.startsWith("floz") || u.startsWith("fluidounce")) return "floz";
  if (u.startsWith("oz") || u.startsWith("ounce")) return "oz";
  if (u.startsWith("lb") || u.startsWith("pound")) return "lb";
  if (u === "g" || u.startsWith("gram")) return "g";
  if (u === "kg") return "kg";
  if (u === "ml" || u.startsWith("milliliter")) return "ml";
  if (u === "l" || u.startsWith("liter")) return "l";
  return u;
}

interface SizeMention {
  value: number;
  unit: string;
  /** True when the word "total" directly follows the size. */
  total: boolean;
}

function sizeMentions(text: string): SizeMention[] {
  const out: SizeMention[] = [];
  for (const m of text.matchAll(SIZE_RE)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    out.push({
      value,
      unit: sizeUnit(m[2]),
      total: /^\s*total\b/i.test(after),
    });
  }
  return out;
}

/**
 * Derived pack quantity from explicit sizes only:
 *   (a) a separately supplied total unit count/size text (e.g. the
 *       catalog "Unit Count: 24 Ounce") divided by the unit size named
 *       in the title, or
 *   (b) a title that states BOTH a total size (marked "total") and a
 *       unit size in the same unit.
 * The division must be a whole number ≥ 2 — anything else is not a
 * pack declaration and yields null.
 */
function derivedPackQty(title: string, unitCountText?: string | null): PackDetection | null {
  const titleSizes = sizeMentions(title);
  const unitSize = titleSizes.find((s) => !s.total) ?? titleSizes[0];

  if (unitCountText) {
    const totals = sizeMentions(unitCountText);
    const total = totals[0];
    if (total && unitSize && total.unit === unitSize.unit && total.value > unitSize.value) {
      const qty = total.value / unitSize.value;
      const sane = sanePack(qty);
      if (sane !== null && sane >= 2) {
        return {
          packQty: sane,
          confidence: "derived",
          evidence: `size division: total ${total.value} ${total.unit} ÷ unit ${unitSize.value} ${unitSize.unit} = ${sane}`,
        };
      }
    }
  }

  const totalSize = titleSizes.find((s) => s.total);
  if (totalSize && unitSize && totalSize !== unitSize && totalSize.unit === unitSize.unit) {
    if (totalSize.value > unitSize.value) {
      const qty = totalSize.value / unitSize.value;
      const sane = sanePack(qty);
      if (sane !== null && sane >= 2) {
        return {
          packQty: sane,
          confidence: "derived",
          evidence: `size division: total ${totalSize.value} ${totalSize.unit} ÷ unit ${unitSize.value} ${unitSize.unit} = ${sane}`,
        };
      }
    }
  }
  return null;
}

/**
 * How many supplier units does this Amazon listing's price buy?
 * Conservative: explicit declarations only; default 1 / "none".
 */
export function detectListingPackQty(
  listingTitle: string | null | undefined,
  unitCountText?: string | null
): PackDetection {
  const title = typeof listingTitle === "string" ? listingTitle : "";
  if (title.trim()) {
    for (const { re, label } of EXPLICIT_PATTERNS) {
      const m = re.exec(title);
      if (!m) continue;
      const qty = sanePack(Number(m[1]));
      if (qty === null) continue;
      return {
        packQty: qty,
        confidence: "explicit",
        evidence: `matched "${label(qty)}" in listing title`,
      };
    }
    const derived = derivedPackQty(title, unitCountText);
    if (derived) return derived;
  } else if (unitCountText) {
    // No title, but a unit-count text on its own can still declare a
    // pack ("Unit Count: 6") — a bare number there is a unit count.
    const bare = /^\s*(\d{1,4})\s*(?:units?|count|ct)?\s*$/i.exec(unitCountText);
    if (bare) {
      const qty = sanePack(Number(bare[1]));
      if (qty !== null && qty >= 2) {
        return {
          packQty: qty,
          confidence: "derived",
          evidence: `unit count text declares ${qty} units`,
        };
      }
    }
  }
  return {
    packQty: 1,
    confidence: "none",
    evidence: "no explicit pack declaration found — price treated as a single unit",
  };
}

// ---------------------------------------------------------------------------
// Normalization decision.
// ---------------------------------------------------------------------------

export type PackNormalizationStatus = "ok" | "unverified_case_upc";

export interface PackNormalization {
  status: PackNormalizationStatus;
  upcKind: SupplierUpcKind;
  pack: PackDetection;
  /** Pack quantity applied (always the detected one; 1 when none). */
  packQty: number;
  /** amazonPrice ÷ packQty, 2dp. NULL when status is
   * "unverified_case_upc" — no candidate-grade unit price exists —
   * or when the Amazon price itself is unusable. */
  unitAmazonPrice: number | null;
  /** Audit sentence for the eval reasons. */
  evidence: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The economics gate: given the pack quantity and the supplier UPC
 * kind, decide the per-unit Amazon price basis — or refuse one.
 * A case-level GTIN-14 supplier UPC means the feed's "unit" cannot be
 * trusted to be the retail unit (the UNREAL fixture: case identifiers
 * wrapped around a per-bag price), so NO unit price is produced and
 * the caller must keep the offer out of candidates.
 */
export function normalizeEconomics(input: {
  amazonPrice: number;
  packQty: number;
  upcKind: SupplierUpcKind;
}): { status: PackNormalizationStatus; unitAmazonPrice: number | null } {
  if (input.upcKind === "case_gtin14") {
    return { status: "unverified_case_upc", unitAmazonPrice: null };
  }
  const qty = sanePack(input.packQty) ?? 1;
  if (!Number.isFinite(input.amazonPrice) || input.amazonPrice <= 0) {
    return { status: "ok", unitAmazonPrice: null };
  }
  return { status: "ok", unitAmazonPrice: round2(input.amazonPrice / qty) };
}

/** Full composition used by the evaluator: UPC kind + pack detection
 * + the economics gate, in one pure call. */
export function analyzeListingPack(input: {
  listingTitle?: string | null;
  unitCountText?: string | null;
  upc?: string | null;
  amazonPrice: number;
}): PackNormalization {
  const upcKind = supplierUpcKind(input.upc);
  const pack = detectListingPackQty(input.listingTitle, input.unitCountText);
  const econ = normalizeEconomics({
    amazonPrice: input.amazonPrice,
    packQty: pack.packQty,
    upcKind,
  });
  const evidence =
    econ.status === "unverified_case_upc"
      ? `supplier UPC ${input.upc ?? ""} is a case-level GTIN-14 — feed unit definition unverified`
      : pack.evidence;
  return {
    status: econ.status,
    upcKind,
    pack,
    packQty: pack.packQty,
    unitAmazonPrice: econ.unitAmazonPrice,
    evidence,
  };
}
