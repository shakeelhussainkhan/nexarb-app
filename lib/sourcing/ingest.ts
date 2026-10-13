import { matchUpcToAsin, matchTitleToAsin, createTokenCache } from "./match";
import { titleTokens } from "./titleMatchCore";
import { SpApiThrottle } from "./throttle";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildWatchlistPayload } from "./orchestrate";
import type { UpcMatch } from "./orchestrate";

/**
 * A product candidate discovered outside the server (e.g. via the live
 * browser session, which passes retailer bot checks that block datacenter
 * IPs). The browser extracts these from clearance/deals pages; this module
 * matches them to Amazon ASINs and feeds them into the watchlist.
 */
export interface BrowserCandidate {
  title: string;
  price: number; // current buy price in USD
  url: string; // absolute retailer product URL
  upc: string | null; // UPC/EAN/GTIN from the product page
  retailer: string; // e.g. "walmart", "target"
}

export interface IngestResult {
  received: number;
  matched: number;
  added: number;
  /** Matches resolved by the title fallback (no usable UPC). */
  titleMatched: number;
  /** Unmatched candidates skipped because the per-call title cap was hit. */
  titleDeferred: number;
  errors: string[];
}

/**
 * Max title-fallback lookups per ingest call. Each lookup is one paced
 * SP-API call (~3s), so 15 keeps the request inside serverless time
 * limits; the caller re-posts remaining candidates in the next batch.
 */
export const TITLE_MATCH_MAX_PER_INGEST = 15;

/**
 * Match browser-discovered candidates to Amazon ASINs via SP-API and insert
 * NEW matches into `watchlist` (dedupe by ASIN, payload cap in
 * buildWatchlistPayload).
 *
 * Matching order: exact UPC first; candidates with no usable UPC (retailer
 * pages often hide it) fall back to strict title matching — brand gate,
 * exact pack/size numeric equality, similarity floor, ambiguity margin
 * (lib/sourcing/titleMatchCore.ts), capped per call so the request stays
 * inside serverless time limits.
 *
 * DISCOVERY ONLY — nothing here purchases, creates intents, or spends money.
 * Never throws: failures are collected into `errors`.
 */
export async function ingestCandidates(
  candidates: BrowserCandidate[],
  buySource?: string
): Promise<IngestResult> {
  const errors: string[] = [];
  const received = candidates.length;

  const spApiCfg = spApiConfigFromEnv(process.env);

  // Validate prices once for every candidate; the rest are eligible for
  // either matching path.
  const valid: BrowserCandidate[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.price) || c.price <= 0) {
      errors.push(`"${(c.title ?? "").slice(0, 40)}": invalid price, skipped`);
      continue;
    }
    valid.push(c);
  }

  // Dedupe by UPC (first occurrence wins) for the exact-match pass.
  const byUpc = new Map<string, BrowserCandidate>();
  for (const c of valid) {
    const upc = (c.upc ?? "").trim();
    if (!upc || byUpc.has(upc)) continue;
    byUpc.set(upc, c);
  }

  // Match each UPC to an Amazon ASIN. Sequential and paced through a
  // shared throttle: kinder to SP-API limits, 429s back off and retry
  // instead of failing the run. One LWA token is reused for the whole run.
  const throttle = new SpApiThrottle();
  const tokenCache = createTokenCache();
  const spFetch: typeof fetch = (input, init) => throttle.fetch(input, init, fetch);
  const matches: UpcMatch[] = [];
  const consumed = new Set<BrowserCandidate>();
  for (const [upc, c] of byUpc) {
    try {
      const { match, reason } = await matchUpcToAsin(spApiCfg, upc, spFetch, { tokenCache });
      if (match) {
        matches.push({ asin: match.asin, title: match.title, buyPrice: c.price, sourceUrl: c.url });
        consumed.add(c);
      } else if (reason) {
        errors.push(`UPC ${upc}: ${reason}`);
      }
    } catch (e) {
      errors.push(`UPC ${upc}: match failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Title fallback for everything the UPC pass did not consume, deduped by
  // normalized title (the same product scraped twice costs one lookup).
  const matchedAsins = new Set(matches.map((m) => m.asin));
  const pool: BrowserCandidate[] = [];
  const seenTitles = new Set<string>();
  for (const c of valid) {
    if (consumed.has(c)) continue;
    const key = titleTokens(c.title ?? "").join(" ");
    if (!key || seenTitles.has(key)) continue;
    seenTitles.add(key);
    pool.push(c);
  }
  const attempts = pool.slice(0, TITLE_MATCH_MAX_PER_INGEST);
  const titleDeferred = pool.length - attempts.length;
  let titleMatched = 0;
  for (const c of attempts) {
    try {
      const { match } = await matchTitleToAsin(spApiCfg, c.title, spFetch, { tokenCache });
      if (match && !matchedAsins.has(match.asin)) {
        matches.push({ asin: match.asin, title: match.title, buyPrice: c.price, sourceUrl: c.url });
        matchedAsins.add(match.asin);
        titleMatched++;
      }
    } catch (e) {
      errors.push(`Title "${(c.title ?? "").slice(0, 40)}": match failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (titleDeferred > 0) {
    errors.push(
      `Title matching capped at ${TITLE_MATCH_MAX_PER_INGEST} lookups per call — ${titleDeferred} candidate(s) deferred; re-post them in the next batch.`
    );
  }

  if (matches.length === 0) {
    return { received, matched: 0, added: 0, titleMatched, titleDeferred, errors };
  }

  // Insert NEW matches only.
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    return {
      received,
      matched: matches.length,
      added: 0,
      titleMatched,
      titleDeferred,
      errors: [...errors, `Supabase unavailable: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const asins = matches.map((m) => m.asin);
  const { data, error } = await admin.from("watchlist").select("asin").in("asin", asins);
  if (error) {
    return {
      received,
      matched: matches.length,
      added: 0,
      titleMatched,
      titleDeferred,
      errors: [...errors, `Could not read watchlist: ${error.message}`],
    };
  }
  const existing = ((data ?? []) as Array<{ asin: string }>).map((r) => r.asin);
  const rows = buildWatchlistPayload(matches, existing, { buySource });

  let added = 0;
  if (rows.length > 0) {
    const { error: writeError } = await admin
      .from("watchlist")
      .upsert(rows, { onConflict: "asin", ignoreDuplicates: true });
    if (writeError) {
      return {
        received,
        matched: matches.length,
        added: 0,
        titleMatched,
        titleDeferred,
        errors: [...errors, `Could not write watchlist: ${writeError.message}`],
      };
    }
    added = rows.length;
  }

  return { received, matched: matches.length, added, titleMatched, titleDeferred, errors };
}
