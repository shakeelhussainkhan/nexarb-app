import { matchUpcToAsin, createTokenCache } from "./match";
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
  errors: string[];
}

/**
 * Match browser-discovered candidates to Amazon ASINs via SP-API and insert
 * NEW matches into `watchlist` (cap 25/run, dedupe by ASIN).
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

  // Dedupe by UPC (first occurrence wins), skip blank UPCs.
  const byUpc = new Map<string, BrowserCandidate>();
  for (const c of candidates) {
    const upc = (c.upc ?? "").trim();
    if (!upc || byUpc.has(upc)) continue;
    if (!Number.isFinite(c.price) || c.price <= 0) {
      errors.push(`"${(c.title ?? "").slice(0, 40)}": invalid price, skipped`);
      continue;
    }
    byUpc.set(upc, c);
  }

  // Match each UPC to an Amazon ASIN. Sequential and paced through a
  // shared throttle: kinder to SP-API limits, 429s back off and retry
  // instead of failing the run. One LWA token is reused for the whole run.
  const throttle = new SpApiThrottle();
  const tokenCache = createTokenCache();
  const spFetch: typeof fetch = (input, init) => throttle.fetch(input, init, fetch);
  const matches: UpcMatch[] = [];
  for (const [upc, c] of byUpc) {
    try {
      const { match, reason } = await matchUpcToAsin(spApiCfg, upc, spFetch, { tokenCache });
      if (match) {
        matches.push({ asin: match.asin, title: match.title, buyPrice: c.price, sourceUrl: c.url });
      } else if (reason) {
        errors.push(`UPC ${upc}: ${reason}`);
      }
    } catch (e) {
      errors.push(`UPC ${upc}: match failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (matches.length === 0) {
    return { received, matched: 0, added: 0, errors };
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
        errors: [...errors, `Could not write watchlist: ${writeError.message}`],
      };
    }
    added = rows.length;
  }

  return { received, matched: matches.length, added, errors };
}
