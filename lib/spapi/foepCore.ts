// Pure core for the SP-API Featured Offer Expected Price (FOEP) batch
// operation — request building, response parsing, and per-SKU summary
// math. No network, no env, no clock except where a caller passes one in,
// so scripts/verify-foep.mjs can drive everything offline.
//
// Wire shapes are Amazon's official Product Pricing API v2022-05-01 model
// (selling-partner-api-models, productPricing_2022-05-01.json) and the
// "Return a batch of FOEP data for a set of SKUs" use-case guide:
//   POST /batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice
//   body: { requests: [{ uri, method: "POST", marketplaceId, sku }] }
//   (per-request params flatten into the request object — the model's
//   FeaturedOfferExpectedPriceRequest is BatchRequest + RequestParams)
//   response: { responses: [{ status: { statusCode }, request: { sku,
//     marketplaceId }, body: { offerIdentifier, featuredOfferExpectedPrice-
//     Results: [{ resultStatus, featuredOfferExpectedPrice: { listingPrice:
//     { currencyCode, amount } }, currentFeaturedOffer, competingFeatured-
//     Offer }], errors } }] }
// Required role: Pricing. Regions: NA/EU/FE. Usage plan: 0.033 rps,
// burst 1 — callers get ONE batch call (up to 40 SKUs), never a loop.
//
// Honesty rules (same as the rest of the app): a price exists only when
// Amazon returned resultStatus VALID_FOEP with a numeric listingPrice
// amount. Every other outcome is an explicit non-price state with a
// human reason — never a fabricated or zero price.

/** URI of the outer batch endpoint. */
export const FOEP_BATCH_PATH =
  "/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice";

/** URI each individual request inside the batch must carry. */
export const FOEP_REQUEST_URI =
  "/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice";

/** Amazon accepts at most 40 FOEP requests per batch call. */
export const FOEP_MAX_SKUS = 40;

export type FoepResultStatus =
  | "VALID_FOEP"
  | "NO_COMPETING_OFFER"
  | "OFFER_NOT_ELIGIBLE"
  | "OFFER_NOT_FOUND"
  | "ASIN_NOT_ELIGIBLE"
  // Amazon may add values; unknown strings pass through untouched.
  | (string & {});

export interface FoepBatchRequestItem {
  uri: string;
  method: "POST";
  marketplaceId: string;
  sku: string;
}

export interface FoepBatchRequestBuild {
  body: { requests: FoepBatchRequestItem[] };
  /** Unique, non-empty SKUs that made it into the batch, in input order. */
  skus: string[];
  /** True when more unique SKUs were supplied than the 40-request cap. */
  capped: boolean;
}

/**
 * Build the batch request body for a set of SKUs. Trims, drops empties,
 * dedupes (first occurrence wins), and caps at FOEP_MAX_SKUS.
 */
export function buildFoepBatchRequest(
  skus: string[],
  marketplaceId: string
): FoepBatchRequestBuild {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of skus) {
    const sku = typeof raw === "string" ? raw.trim() : "";
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    unique.push(sku);
  }
  const capped = unique.length > FOEP_MAX_SKUS;
  const picked = unique.slice(0, FOEP_MAX_SKUS);
  return {
    body: {
      requests: picked.map((sku) => ({
        uri: FOEP_REQUEST_URI,
        method: "POST" as const,
        marketplaceId,
        sku,
      })),
    },
    skus: picked,
    capped,
  };
}

/** One parsed per-SKU outcome. Prices are null unless Amazon proved them. */
export interface FoepSkuResult {
  sku: string;
  asin: string | null;
  /** Per-request HTTP status inside the batch; null when absent. */
  httpStatus: number | null;
  /** Amazon's resultStatus verbatim; null when no usable result arrived. */
  resultStatus: FoepResultStatus | null;
  /** The FOEP listing price — set ONLY for VALID_FOEP with a real amount. */
  expectedPrice: number | null;
  currency: string;
  /** Current featured offer's listing price, when Amazon returned one. */
  currentFeaturedPrice: number | null;
  /** Competing featured offer's listing price, when Amazon returned one. */
  competingFeaturedPrice: number | null;
  /** Why there is no price, when there isn't one. Null when priced. */
  errorReason: string | null;
}

interface MoneyLike {
  amount?: unknown;
  currencyCode?: unknown;
}

function moneyAmount(m: MoneyLike | undefined | null): number | null {
  const a = m?.amount;
  return typeof a === "number" && Number.isFinite(a) && a > 0
    ? Math.round(a * 100) / 100
    : null;
}

function moneyCurrency(m: MoneyLike | undefined | null): string | null {
  const c = m?.currencyCode;
  return typeof c === "string" && c.length > 0 ? c : null;
}

interface RawFeaturedOffer {
  price?: { listingPrice?: MoneyLike };
}

function offerPrice(o: RawFeaturedOffer | undefined | null): number | null {
  return moneyAmount(o?.price?.listingPrice);
}

/** A result for a SKU Amazon gave us nothing usable for. */
export function unavailableFoepResult(sku: string, reason: string): FoepSkuResult {
  return {
    sku,
    asin: null,
    httpStatus: null,
    resultStatus: null,
    expectedPrice: null,
    currency: "USD",
    currentFeaturedPrice: null,
    competingFeaturedPrice: null,
    errorReason: reason,
  };
}

/**
 * Parse a raw getFeaturedOfferExpectedPriceBatch response into one
 * FoepSkuResult per requested SKU, in request order. Responses are
 * matched back by their echoed `request.sku`; a requested SKU with no
 * matching response gets an explicit unavailable result.
 */
export function parseFoepBatchResponse(
  raw: unknown,
  requestedSkus: string[]
): FoepSkuResult[] {
  const responses =
    (raw as { responses?: unknown[] } | null)?.responses ?? [];
  const bySku = new Map<string, Record<string, unknown>>();
  if (Array.isArray(responses)) {
    for (const r of responses) {
      const item = r as Record<string, unknown> | null;
      const reqSku = (item?.request as { sku?: unknown } | undefined)?.sku;
      if (typeof reqSku === "string" && !bySku.has(reqSku)) {
        bySku.set(reqSku, item as Record<string, unknown>);
      }
    }
  }

  return requestedSkus.map((sku) => {
    const item = bySku.get(sku);
    if (!item) {
      return unavailableFoepResult(
        sku,
        "Amazon returned no response for this SKU in the FOEP batch."
      );
    }
    const statusCode = (item.status as { statusCode?: unknown } | undefined)
      ?.statusCode;
    const httpStatus =
      typeof statusCode === "number" ? statusCode : null;
    const body = (item.body ?? {}) as {
      offerIdentifier?: { asin?: unknown };
      featuredOfferExpectedPriceResults?: Array<{
        resultStatus?: unknown;
        featuredOfferExpectedPrice?: { listingPrice?: MoneyLike };
        currentFeaturedOffer?: RawFeaturedOffer;
        competingFeaturedOffer?: RawFeaturedOffer;
      }>;
      errors?: Array<{ code?: unknown; message?: unknown }>;
    };

    const asinRaw = body.offerIdentifier?.asin;
    const asin = typeof asinRaw === "string" && asinRaw ? asinRaw : null;

    const firstError = Array.isArray(body.errors) ? body.errors[0] : undefined;
    const httpError =
      httpStatus != null && httpStatus !== 200
        ? `FOEP request failed with HTTP ${httpStatus}` +
          (firstError?.message ? ` — ${String(firstError.message)}` : "")
        : null;

    const results = Array.isArray(body.featuredOfferExpectedPriceResults)
      ? body.featuredOfferExpectedPriceResults
      : [];
    const first = results[0];
    const resultStatus =
      typeof first?.resultStatus === "string" && first.resultStatus
        ? (first.resultStatus as FoepResultStatus)
        : null;

    // The price exists only for a VALID_FOEP result carrying a real
    // numeric amount. Anything else stays null — never invented.
    let expectedPrice: number | null = null;
    let currency: string | null = null;
    if (resultStatus === "VALID_FOEP" && !httpError) {
      expectedPrice = moneyAmount(first?.featuredOfferExpectedPrice?.listingPrice);
      currency = moneyCurrency(first?.featuredOfferExpectedPrice?.listingPrice);
    }

    let errorReason: string | null = httpError;
    if (!errorReason && expectedPrice == null) {
      if (resultStatus === "VALID_FOEP") {
        errorReason =
          "Amazon reported a valid FOEP but returned no numeric price — treated as unavailable.";
      } else if (firstError?.message) {
        errorReason = String(firstError.message);
      }
    }

    return {
      sku,
      asin,
      httpStatus,
      resultStatus,
      expectedPrice,
      currency: currency ?? "USD",
      currentFeaturedPrice: offerPrice(first?.currentFeaturedOffer),
      competingFeaturedPrice: offerPrice(first?.competingFeaturedOffer),
      errorReason,
    };
  });
}

export type FoepSummaryState = "valid" | "no-competition" | "unavailable";

export interface FoepSummary {
  state: FoepSummaryState;
  /** Win price — non-null only in state "valid". */
  expectedPrice: number | null;
  currency: string;
  /** ourPrice − expectedPrice, cents-rounded; positive means "lower by". */
  gap: number | null;
  /** One-line human framing for the UI tooltip / API consumer. */
  note: string;
  /** Short action framing when a gap exists; null otherwise. */
  gapText: string | null;
}

const STATUS_NOTES: Record<string, string> = {
  NO_COMPETING_OFFER:
    "No other offers ship nationwide for this ASIN — Amazon returned no win price.",
  OFFER_NOT_ELIGIBLE:
    "This offer is not eligible to become the Featured Offer.",
  OFFER_NOT_FOUND:
    "Amazon could not find this offer (unbuyable, or not qualified to be featured).",
  ASIN_NOT_ELIGIBLE: "This ASIN is not eligible for a Featured Offer price.",
};

/**
 * Fold a parsed result plus our current price into the UI-facing summary:
 * the win price and the exact gap to it, or an honest non-price state.
 */
export function summarizeFoep(
  result: FoepSkuResult,
  ourPrice: number | null
): FoepSummary {
  const base = { currency: result.currency };
  if (result.resultStatus === "VALID_FOEP" && result.expectedPrice != null) {
    const gap =
      ourPrice != null && ourPrice > 0
        ? Math.round((ourPrice - result.expectedPrice) * 100) / 100
        : null;
    return {
      ...base,
      state: "valid",
      expectedPrice: result.expectedPrice,
      gap,
      note: "Amazon's computed price at or below which this offer can expect to win the Featured Offer (before promotions). Not a guarantee.",
      gapText:
        gap == null
          ? null
          : gap > 0
            ? `Lower by $${gap.toFixed(2)} to reach it`
            : "Your price is at or under the win price",
    };
  }
  if (result.resultStatus === "NO_COMPETING_OFFER") {
    return {
      ...base,
      state: "no-competition",
      expectedPrice: null,
      gap: null,
      note: STATUS_NOTES.NO_COMPETING_OFFER,
      gapText: null,
    };
  }
  const note =
    (result.resultStatus && STATUS_NOTES[result.resultStatus]) ||
    result.errorReason ||
    "Amazon returned no Featured Offer price for this SKU.";
  return {
    ...base,
    state: "unavailable",
    expectedPrice: null,
    gap: null,
    note,
    gapText: null,
  };
}
