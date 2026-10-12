// Orchestration helpers for the deal-discovery sweeper (POST /api/sourcing/sweep).
//
// Flow: sweep Walmart clearance -> extract UPCs -> match each UPC to an Amazon
// ASIN via SP-API -> insert NEW matches into `watchlist` as candidates for the
// verification engine.
//
// The decision logic here is pure (no network, no secrets) so it can be
// unit-tested offline. Discovery only writes watchlist candidates — nothing
// here purchases, creates intents, or spends money.

/** Tag written to watchlist.buy_source for sweeper-discovered candidates. */
export const SWEEP_BUY_SOURCE = "walmart-clearance";

/** Max NEW watchlist rows a single sweep run may insert. */
export const MAX_NEW_WATCHLIST_ROWS = 100;

/**
 * Max candidates accepted per /api/sourcing/discover call. Aligned with
 * MAX_NEW_WATCHLIST_ROWS so one browser batch can fill one sweep's budget.
 */
export const MAX_CANDIDATES_PER_INGEST = 100;

/** A successful UPC -> ASIN match paired with the discovered buy price. */
export interface UpcMatch {
  asin: string;
  title: string;
  buyPrice: number;
  sourceUrl?: string | null; // retailer product URL captured at discovery
}

/** Row shape for inserting into the `watchlist` table (migration 006). */
export interface WatchlistRow {
  asin: string;
  title: string;
  buy_price: number;
  buy_source: string;
  category: string | null;
  active: boolean;
  source_url?: string | null; // migration 008 — feeds assisted checkout
}

export interface BuildPayloadOptions {
  maxNew?: number;
  buySource?: string;
}

/**
 * Build the watchlist upsert payload from UPC->ASIN matches.
 *
 * - Dedupes by ASIN (first occurrence wins)
 * - Skips ASINs already present in `existingAsins`
 * - Skips blank ASINs
 * - Caps the payload at `maxNew` (default 100) new rows
 */
export function buildWatchlistPayload(
  matches: UpcMatch[],
  existingAsins: Iterable<string>,
  opts?: BuildPayloadOptions
): WatchlistRow[] {
  const maxNew = opts?.maxNew ?? MAX_NEW_WATCHLIST_ROWS;
  const buySource = opts?.buySource ?? SWEEP_BUY_SOURCE;
  const seen = new Set<string>(existingAsins);
  const rows: WatchlistRow[] = [];
  for (const m of matches) {
    if (rows.length >= maxNew) break;
    const asin = m.asin?.trim();
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    rows.push({
      asin,
      title: m.title,
      buy_price: m.buyPrice,
      buy_source: buySource,
      category: null,
      active: true,
      source_url: m.sourceUrl ?? null,
    });
  }
  return rows;
}
