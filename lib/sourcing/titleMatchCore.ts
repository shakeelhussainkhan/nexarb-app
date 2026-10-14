// Title -> ASIN matching core for discovery candidates that carry NO UPC.
//
// Walmart/Target product pages often hide the UPC from scrapers, so the
// UPC matcher (lib/sourcing/match.ts) cannot resolve most candidates.
// This module scores an Amazon Catalog Items keyword-search result set
// against the retailer's product title and decides — conservatively —
// whether one item is the same product.
//
// A wrong match is worse than no match: it would put a wrong buy price
// against a real ASIN and could manufacture phantom profit. The engine
// still re-verifies every watchlist row with live prices and eligibility
// before any BUY verdict, and nothing purchases without the founder
// approving the exact intent — but the matcher is strict anyway:
//
//   1. Brand must check out (catalog brand tokens must appear in the
//      retailer title; without a catalog brand, the retailer title's
//      first token must appear in the catalog title).
//   2. Numeric tokens must match EXACTLY (pack counts, sizes, quantities
//      discriminate variants: "5.1 oz" single vs "5.1 oz, 2 Pack" differ).
//   3. Token similarity (Jaccard over meaningful tokens) must clear
//      MIN_TITLE_SCORE.
//   4. The best candidate must beat the runner-up by AMBIGUITY_MARGIN,
//      otherwise the match is ambiguous and rejected.
//
// Pure logic only (no network, no secrets) so the offline harness can
// exercise every rule.

export interface CatalogTitleItem {
  asin: string;
  title: string;
  brand?: string | null;
  imageUrl?: string | null;
}

export interface TitleMatchPick {
  asin: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  score: number;
  reason: string;
}

export interface TitleMatchDecision {
  match: TitleMatchPick | null;
  reason: string;
}

/** Minimum Jaccard similarity over meaningful title tokens. */
export const MIN_TITLE_SCORE = 0.5;
/** Best item must beat the second-best passing item by this much. */
export const AMBIGUITY_MARGIN = 0.08;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "with", "for", "of", "in", "on", "at",
  "by", "from", "to", "new", "free",
]);

/** Light plural normalization so "sponges" and "sponge" compare equal. */
function stem(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Normalize a title into meaningful tokens: lowercase, punctuation to
 * spaces, stopwords dropped, light stemming applied. Order preserved,
 * duplicates removed.
 */
export function titleTokens(title: string): string[] {
  const raw = (title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw) {
    if (!piece) continue;
    const tok = /^\d+$/.test(piece) ? piece : stem(piece);
    if (STOPWORDS.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** Numeric tokens of a title ("5.1 oz, 2 pack" -> {"5","1","2"}). */
export function numericTokens(title: string): Set<string> {
  return new Set(titleTokens(title).filter((t) => /^\d+$/.test(t)));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Jaccard similarity over the meaningful token sets of two titles. */
export function titleSimilarity(aTitle: string, bTitle: string): number {
  const a = new Set(titleTokens(aTitle));
  const b = new Set(titleTokens(bTitle));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Brand gate. With a catalog brand, every brand token must appear in the
 * retailer title. Without one, the retailer title's first meaningful
 * token (usually the brand on retailer pages) must appear in the
 * catalog title.
 */
export function brandPasses(
  candidateTitle: string,
  item: CatalogTitleItem
): boolean {
  const candTokens = new Set(titleTokens(candidateTitle));
  const brand = (item.brand ?? "").trim();
  if (brand) {
    const brandTokens = titleTokens(brand);
    if (brandTokens.length > 0) {
      return brandTokens.every((t) => candTokens.has(t));
    }
  }
  const first = titleTokens(candidateTitle)[0];
  if (!first) return false;
  return new Set(titleTokens(item.title)).has(first);
}

/**
 * Build the SP-API keywords query: the first `maxTokens` meaningful
 * tokens of the retailer title (brand + product words + sizes, in the
 * order the retailer presents them).
 */
export function buildKeywordQuery(title: string, maxTokens = 8): string {
  return titleTokens(title).slice(0, maxTokens).join(" ");
}

/**
 * Decide whether any catalog item is the same product as the retailer
 * candidate. Applies brand gate, exact numeric-token equality, the
 * similarity floor, and the ambiguity margin, in that order.
 */
export function pickTitleMatch(
  candidateTitle: string,
  items: CatalogTitleItem[]
): TitleMatchDecision {
  const candNums = numericTokens(candidateTitle);
  const scored: Array<{ item: CatalogTitleItem; score: number }> = [];
  let brandFails = 0;
  let numericFails = 0;
  for (const item of items ?? []) {
    const asin = (item.asin ?? "").trim();
    if (!asin || !item.title) continue;
    if (!brandPasses(candidateTitle, item)) {
      brandFails++;
      continue;
    }
    if (!setsEqual(candNums, numericTokens(item.title))) {
      numericFails++;
      continue;
    }
    scored.push({ item, score: titleSimilarity(candidateTitle, item.title) });
  }
  if (scored.length === 0) {
    const why =
      brandFails > 0 && numericFails === 0
        ? "brand did not match any catalog result"
        : numericFails > 0 && brandFails === 0
          ? "pack/size numbers did not match any catalog result"
          : "no catalog result passed the brand and pack/size gates";
    return { match: null, reason: `Title match rejected: ${why}.` };
  }
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (best.score < MIN_TITLE_SCORE) {
    return {
      match: null,
      reason: `Title match rejected: best similarity ${best.score.toFixed(2)} below ${MIN_TITLE_SCORE} floor.`,
    };
  }
  const second = scored[1];
  if (second && best.score - second.score < AMBIGUITY_MARGIN) {
    return {
      match: null,
      reason: `Title match rejected: ambiguous — top scores ${best.score.toFixed(2)} vs ${second.score.toFixed(2)} within ${AMBIGUITY_MARGIN}.`,
    };
  }
  return {
    match: {
      asin: best.item.asin.trim(),
      title: best.item.title,
      brand: best.item.brand ?? null,
      imageUrl: best.item.imageUrl ?? null,
      score: best.score,
      reason: `Title matched ASIN ${best.item.asin.trim()} (similarity ${best.score.toFixed(2)}, brand + pack/size verified).`,
    },
    reason: `Title matched ASIN ${best.item.asin.trim()} (similarity ${best.score.toFixed(2)}).`,
  };
}
