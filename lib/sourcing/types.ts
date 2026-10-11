// Pluggable retailer adapter interface for first-party deal discovery.
//
// Walmart clearance is the first source adapter; Target, Costco, and other
// leading stores plug in here later. Every adapter speaks the same candidate
// shape so the sweep route, UPC→ASIN matcher, and watchlist upsert never
// change when a retailer is added.
//
// To add a retailer, see lib/sourcing/README.md.

/** One discovered candidate product, retailer-agnostic. */
export interface SourcedCandidate {
  title: string;
  price: number; // current buy price in USD
  wasPrice: number | null;
  url: string; // absolute product URL on the retailer
  upc: string | null; // null when the retailer doesn't expose one
  retailer: string; // adapter slug, e.g. "walmart" | "target" | "costco"
  image?: string;
}

/** Outcome of one adapter sweep. Adapters NEVER throw. */
export interface SweepOutcome {
  items: SourcedCandidate[];
  errors: string[];
}

/** Options every adapter accepts (adapters may ignore what they don't need). */
export interface AdapterSweepOptions {
  maxItems?: number;
  fetchUpc?: boolean;
  maxUpcFetches?: number;
  fetchFn?: typeof fetch;
  delayMs?: number;
}

/**
 * A retailer's discovery source. Implementations must:
 *  - use plain fetch + HTML/JSON parsing (no browser automation, no paid APIs),
 *  - be polite (real user-agent, small concurrency, delays between requests),
 *  - NEVER throw: per-item/per-request errors go into `errors`,
 *  - never purchase, create intents, or spend money — discovery only.
 */
export interface RetailerAdapter {
  readonly slug: string; // e.g. "walmart" — buy_source becomes `${slug}-clearance`
  readonly displayName: string; // e.g. "Walmart"
  sweep(opts?: AdapterSweepOptions): Promise<SweepOutcome>;
}
