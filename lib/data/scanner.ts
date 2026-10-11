// Retailer-side scanners for the first-party data platform.
//
// The scanner contract: each retailer adapter produces validated SourceOffer
// records. Phase 0 ships exactly one working adapter — ManualOfferAdapter for
// operator-entered offers. Everything else is a clearly-marked STUB that
// throws: NexArb will NOT scrape retailer sites (violates most retailers'
// Terms of Service and risks IP blocks). Future retailer integrations arrive
// as official retailer data feeds / affiliate APIs or operator entry.

import type { SourceOffer, StockState } from "./types.ts";

export interface RetailerScanner {
  readonly name: string;
  scan(): Promise<SourceOffer[]>;
}

const STOCK_STATES: StockState[] = ["in-stock", "limited", "out-of-stock", "unknown"];

function validateOffer(scannerName: string, offer: SourceOffer): void {
  const problems: string[] = [];
  if (!offer.retailer) problems.push("retailer is required");
  if (!offer.url) problems.push("url is required");
  if (!offer.title) problems.push("title is required");
  if (!(offer.price > 0)) problems.push(`price must be > 0 (got ${String(offer.price)})`);
  if (!offer.currency) problems.push("currency is required");
  if (!STOCK_STATES.includes(offer.stockState)) problems.push(`invalid stockState "${String(offer.stockState)}"`);
  if (!(offer.matchConfidence >= 0 && offer.matchConfidence <= 1))
    problems.push(`matchConfidence must be 0..1 (got ${String(offer.matchConfidence)})`);
  if (!offer.capturedAt || Number.isNaN(Date.parse(offer.capturedAt)))
    problems.push("capturedAt must be a valid ISO-8601 timestamp");
  if (problems.length > 0) {
    throw new Error(`[${scannerName}] invalid offer (${offer.url || "<no url>"}): ${problems.join("; ")}`);
  }
}

// Operator-entered offers: the founder (or an operator) enters deal data by
// hand. Every record is validated before it enters the pipeline — invalid
// records abort the scan with a descriptive error rather than flowing through
// half-valid.
export class ManualOfferAdapter implements RetailerScanner {
  readonly name = "manual";
  private readonly offers: SourceOffer[];

  constructor(offers: SourceOffer[]) {
    this.offers = offers;
  }

  async scan(): Promise<SourceOffer[]> {
    for (const offer of this.offers) validateOffer(this.name, offer);
    return this.offers.map((o) => ({ ...o }));
  }
}

function notImplemented(retailer: string): Error {
  return new Error(
    `[${retailer}] not implemented — no live retailer scraping (retailer ToS). ` +
      "Use ManualOfferAdapter for operator-entered offers, or a future official retailer data feed."
  );
}

// ---------------- STUB adapters (not implemented, throw on use) ----------------

export class WalmartStubScanner implements RetailerScanner {
  readonly name = "walmart";
  async scan(): Promise<SourceOffer[]> {
    throw notImplemented(this.name);
  }
}

export class TargetStubScanner implements RetailerScanner {
  readonly name = "target";
  async scan(): Promise<SourceOffer[]> {
    throw notImplemented(this.name);
  }
}

export class BestBuyStubScanner implements RetailerScanner {
  readonly name = "bestbuy";
  async scan(): Promise<SourceOffer[]> {
    throw notImplemented(this.name);
  }
}
