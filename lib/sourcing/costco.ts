import type {
  AdapterSweepOptions,
  RetailerAdapter,
  SourcedCandidate,
  SweepOutcome,
} from "./types";

// Costco sourcing — plain fetch + HTML/JSON parsing, no browser, no paid APIs.
//
// Same RetailerAdapter contract as Walmart: sweep costco.com clearance/deals
// search results for candidate products, then fetch product pages to extract
// the GTIN/UPC (needed to match the Amazon catalog via SP-API).
//
// NOTE: costco.com is heavily bot-protected; server-side fetches will very
// likely be blocked (the sweep reports it gracefully via `errors`). The live
// discovery path is the browser session posting candidates to
// /api/sourcing/discover — this adapter defines the candidate shape and the
// parsing contract that flow relies on.
//
// Everything is defensive: per-item and per-request errors are collected into
// `errors` (capped), and sweepCostcoDeals NEVER throws. Nothing here
// purchases anything.

export interface CostcoProduct {
  title: string;
  price: number; // current buy price in USD
  wasPrice: number | null;
  url: string; // absolute costco.com product URL
  upc: string | null; // null until product page is fetched
  image?: string;
}

export interface CostcoSweepOptions {
  maxItems?: number; // default 50, hard cap 100
  fetchUpc?: boolean; // default true: fetch each product page for GTIN
  maxUpcFetches?: number; // default 100
  fetchFn?: typeof fetch; // injectable for tests
  delayMs?: number; // default 800 between requests
}

const SEARCH_URL =
  "https://www.costco.com/CatalogSearch?dept=All&keyword=clearance";
const BASE = "https://www.costco.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_ITEMS_HARD_CAP = 100;
const MAX_ERRORS = 20;

function pageHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Small value helpers (same shapes as the Walmart adapter uses)
// ---------------------------------------------------------------------------

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// Obvious non-resellable junk: gift cards, memberships, tires-as-service etc.
const JUNK_TITLE_RE = /\bgift\s*cards?\b|\bmembership\b/i;

function normalizeGtin(v: string): string | null {
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return null;
}

const GTIN_KEYS = ["gtin13", "gtin12", "gtin14", "gtin8", "gtin", "upc"];

function findGtin(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const el of node) {
      const hit = findGtin(el);
      if (hit) return hit;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  for (const key of GTIN_KEYS) {
    const v = asString(node[key]);
    if (v) {
      const norm = normalizeGtin(v);
      if (norm) return norm;
    }
  }
  for (const key of Object.keys(node)) {
    const hit = findGtin(node[key]);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON-LD product extraction (pure — offline-testable)
// ---------------------------------------------------------------------------

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Pull a USD price out of a schema.org Product node's offers. */
function priceFromOffers(node: Record<string, unknown>): number | null {
  const offers = node.offers;
  const list = Array.isArray(offers) ? offers : offers !== undefined ? [offers] : [];
  for (const o of list) {
    if (!isRecord(o)) continue;
    // offers.price may be a number/string directly on the offer.
    const direct = asNumber(o.price);
    if (direct !== null) return direct;
  }
  // Nested priceSpecification shape
  for (const o of list) {
    if (!isRecord(o)) continue;
    const spec = o.priceSpecification;
    if (isRecord(spec)) {
      const p = asNumber(spec.price);
      if (p !== null) return p;
    }
  }
  return null;
}

function productFromNode(node: Record<string, unknown>): CostcoProduct | null {
  const title = asString(node.name);
  if (!title) return null;
  if (JUNK_TITLE_RE.test(title)) return null;

  const price = priceFromOffers(node);
  if (price === null || price <= 0) return null;

  let url = asString(node.url);
  if (url && url.startsWith("/")) url = BASE + url;
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const image = asString(node.image) ?? undefined;
  const upc = findGtin(node);

  return {
    title,
    price,
    wasPrice: null,
    url,
    upc,
    ...(image ? { image } : {}),
  };
}

// Deep-walk parsed JSON-LD looking for Product-typed nodes (or typeless
// nodes carrying name+offers). ItemList wrappers are descended into.
function walkForProducts(root: unknown, out: CostcoProduct[]): void {
  const seen = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }
    if (!isRecord(cur)) continue;
    // Unwrap ItemList containers without converting them.
    const type = asString(cur["@type"]);
    if (type && /itemlist/i.test(type) && cur.itemListElement !== undefined) {
      stack.push(cur.itemListElement);
      continue;
    }
    const p = productFromNode(cur);
    if (p) {
      if (!seen.has(p.url)) {
        seen.add(p.url);
        out.push(p);
      }
      continue; // don't descend into a converted product node
    }
    for (const key of Object.keys(cur)) stack.push(cur[key]);
  }
}

/**
 * Extract candidate products from a Costco search page's HTML by parsing its
 * JSON-LD blocks. Pure function, safe for the offline harness.
 */
export function parseCostcoSearchPayload(html: string): CostcoProduct[] {
  const out: CostcoProduct[] = [];
  try {
    LD_JSON_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LD_JSON_RE.exec(html)) !== null) {
      const raw = (m[1] ?? "").trim();
      if (!raw) continue;
      try {
        walkForProducts(JSON.parse(raw), out);
      } catch {
        // malformed block — try the next one
      }
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * Extract the GTIN/UPC from a Costco product page's JSON-LD blocks.
 * Returns the digit-normalized code, or null when absent.
 */
export function parseCostcoUpcFromProductPage(html: string): string | null {
  try {
    LD_JSON_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LD_JSON_RE.exec(html)) !== null) {
      const raw = (m[1] ?? "").trim();
      if (!raw) continue;
      try {
        const hit = findGtin(JSON.parse(raw));
        if (hit) return hit;
      } catch {
        // malformed block — try the next one
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// sweepCostcoDeals
// ---------------------------------------------------------------------------

const BLOCKED_BODY_MARKERS = [
  "px-captcha",
  "perimeterx",
  "captcha",
  "access denied",
  "are you a robot",
  "request blocked",
  "robot check",
  "akamai",
  "imperva",
];

function looksBlocked(status: number, body: string): string | null {
  if (status === 403 || status === 429 || status === 503) {
    return `costco blocked: ${status}`;
  }
  if (body.trim().length === 0) return "costco blocked: empty response";
  const lower = body.toLowerCase();
  for (const marker of BLOCKED_BODY_MARKERS) {
    if (lower.includes(marker)) return `costco blocked: bot-check (${status})`;
  }
  return null;
}

export async function sweepCostcoDeals(
  opts?: CostcoSweepOptions
): Promise<{ items: CostcoProduct[]; errors: string[] }> {
  const errors: string[] = [];
  const pushError = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  try {
    const fetchFn = opts?.fetchFn ?? fetch;
    const delayMs = opts?.delayMs ?? 800;
    const fetchUpc = opts?.fetchUpc ?? true;
    const maxUpcFetches = Math.max(0, opts?.maxUpcFetches ?? 100);
    const maxItems = Math.min(
      Math.max(0, opts?.maxItems ?? 50),
      MAX_ITEMS_HARD_CAP
    );

    // --- 1. Fetch the clearance search page ---
    let searchRes: globalThis.Response;
    try {
      searchRes = await fetchFn(SEARCH_URL, { headers: pageHeaders() });
    } catch (e) {
      return {
        items: [],
        errors: [
          `costco search failed: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }

    let searchBody = "";
    try {
      searchBody = await searchRes.text();
    } catch (e) {
      pushError(
        `costco search body unreadable: ${e instanceof Error ? e.message : String(e)}`
      );
      searchBody = "";
    }

    const blocked = looksBlocked(searchRes.status, searchBody);
    if (blocked) {
      return { items: [], errors: [blocked] };
    }
    if (!searchRes.ok) {
      return {
        items: [],
        errors: [`costco search failed: http ${searchRes.status}`],
      };
    }

    // --- 2. Parse products from JSON-LD blocks ---
    const products = parseCostcoSearchPayload(searchBody).slice(0, maxItems);

    // --- 3. Fetch product pages for GTINs (2 at a time, delayMs apart) ---
    if (fetchUpc && maxUpcFetches > 0 && products.length > 0) {
      const targets = products.slice(0, Math.min(maxUpcFetches, products.length));
      let next = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= targets.length) return;
          const p = targets[i];
          try {
            await sleep(delayMs);
            let res: globalThis.Response;
            try {
              res = await fetchFn(p.url, { headers: pageHeaders() });
            } catch (e) {
              pushError(
                `upc fetch failed for ${p.url}: ${e instanceof Error ? e.message : String(e)}`
              );
              continue;
            }
            if (!res.ok) {
              if (res.status === 403 || res.status === 429) {
                pushError(`costco blocked on product page: ${res.status}`);
              }
              continue;
            }
            let html = "";
            try {
              html = await res.text();
            } catch (e) {
              pushError(
                `product page unreadable for ${p.url}: ${e instanceof Error ? e.message : String(e)}`
              );
              continue;
            }
            const upc = parseCostcoUpcFromProductPage(html);
            if (upc) p.upc = upc;
          } catch (e) {
            pushError(
              `unexpected error for ${p.url}: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
      };
      try {
        await Promise.all([worker(), worker()]);
      } catch (e) {
        pushError(
          `upc worker failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    return { items: products, errors };
  } catch (e) {
    // Absolute guarantee: never throws.
    pushError(`sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    return { items: [], errors };
  }
}

// ---------------------------------------------------------------------------
// RetailerAdapter implementation
// ---------------------------------------------------------------------------

export const costcoAdapter: RetailerAdapter = {
  slug: "costco",
  displayName: "Costco",
  async sweep(opts?: AdapterSweepOptions): Promise<SweepOutcome> {
    const result = await sweepCostcoDeals(opts);
    const items: SourcedCandidate[] = result.items.map((p) => ({
      ...p,
      retailer: "costco",
    }));
    return { items, errors: result.errors };
  },
};
