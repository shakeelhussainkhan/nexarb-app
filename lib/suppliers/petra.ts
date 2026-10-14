// Petra adapter over the shared supplier-offer wiring (lib/suppliers/
// offers.ts): ingest upsert, UPC→ASIN matching, and the Amazon
// pricing/margin pass, pinned to supplier "petra". The pure parsing and
// fee math live in lib/suppliers/petraCore.ts; routes stay thin.
//
// Phase 1 scope: ingest + match + price ONLY. Nothing here orders, creates
// purchase intents, or spends money.

import type { SupplierOffer } from "./petraCore";
import {
  ingestSupplierOffers,
  matchPendingSupplierOffers,
  priceMatchedSupplierOffers,
  type IngestOffersResult,
  type MatchOffersResult,
  type PriceOffersResult,
} from "./offers";

export type { IngestOffersResult, MatchOffersResult, PriceOffersResult };

export function ingestPetraOffers(
  offers: SupplierOffer[],
  sourceFileDate: string | null
): Promise<IngestOffersResult> {
  return ingestSupplierOffers("petra", offers, sourceFileDate);
}

export function matchPendingPetraOffers(limit = 50): Promise<MatchOffersResult> {
  return matchPendingSupplierOffers("petra", limit);
}

export function priceMatchedPetraOffers(cap = 100): Promise<PriceOffersResult> {
  return priceMatchedSupplierOffers("petra", cap);
}
