import type {
  AdapterSweepOptions,
  RetailerAdapter,
  SourcedCandidate,
  SweepOutcome,
} from "./types";

// Walmart clearance sourcing — plain fetch + HTML/JSON parsing, no browser, no paid APIs.
//
// This is the first-party deal-discovery input for NexArb: scrape walmart.com
// clearance/search pages for candidate products, then fetch each product page
// to extract the UPC (needed to match Amazon catalog via SP-API).
//
// Everything is defensive: per-item and per-request errors are collected into
// `errors` (capped), and sweepWalmartClearance NEVER throws. Nothing here
// purchases anything.

export interface SourcedProduct {
  title: string;
  price: number; // current buy price in USD
  wasPrice: number | null;
  url: string; // absolute walmart.com product URL
  upc: string | null; // null until product page is fetched
  image?: string;
}

export interface SweepResult {
  items: SourcedProduct[];
  errors: string[];
}

export interface SweepOptions {
  maxItems?: number; // default 50, hard cap
  fetchUpc?: boolean; // default true: fetch each product page for UPC
  maxUpcFetches?: number; // default 25
  fetchFn?: typeof fetch; // injectable for tests
  delayMs?: number; // default 800 between requests
}

const SEARCH_URL = "https://www.walmart.com/search?q=clearance";
const BASE = "https://www.walmart.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_ITEMS_HARD_CAP = 50;
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
// Small value helpers
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

// Obvious non-resellable junk: gift cards (and variants).
const JUNK_TITLE_RE = /\bgift\s*cards?\b/i;

function absoluteProductUrl(
  canonicalUrl: string | null,
  itemId: string | null
): string | null {
  if (canonicalUrl) {
    if (canonicalUrl.startsWith("http")) return canonicalUrl;
    if (canonicalUrl.startsWith("/")) return BASE + canonicalUrl;
  }
  if (itemId) return `${BASE}/ip/${itemId}`;
  return null;
}

// ---------------------------------------------------------------------------
// parseSearchPayload
// ---------------------------------------------------------------------------

// Pull a current price out of the many shapes Walmart's frontend uses.
function priceFromNode(node: Record<string, unknown>): number | null {
  const direct: unknown[] = [
    node.price,
    node.currentPrice,
    node.salesPrice,
    node.salePrice,
  ];
  for (const c of direct) {
    const n = asNumber(c);
    if (n !== null) return n;
  }
  const priceInfo = node.priceInfo;
  if (isRecord(priceInfo)) {
    const cp = priceInfo.currentPrice;
    if (isRecord(cp)) {
      const n = asNumber(cp.price);
      if (n !== null) return n;
    }
    const n2 = asNumber(cp);
    if (n2 !== null) return n2;
    const n3 = asNumber(priceInfo.price);
    if (n3 !== null) return n3;
  }
  return null;
}

function wasPriceFromNode(node: Record<string, unknown>): number | null {
  const direct: unknown[] = [node.wasPrice, node.listPrice, node.msrp];
  for (const c of direct) {
    const n = asNumber(c);
    if (n !== null) return n;
  }
  const priceInfo = node.priceInfo;
  if (isRecord(priceInfo)) {
    const wp = priceInfo.wasPrice;
    if (isRecord(wp)) {
      const n = asNumber(wp.price);
      if (n !== null) return n;
    }
    const n2 = asNumber(wp);
    if (n2 !== null) return n2;
  }
  return null;
}

function nodeToProduct(node: Record<string, unknown>): SourcedProduct | null {
  const title =
    asString(node.name) ?? asString(node.title) ?? asString(node.productName);
  if (!title) return null;
  if (JUNK_TITLE_RE.test(title)) return null;

  const price = priceFromNode(node);
  if (price === null || price <= 0) return null;

  const canonicalUrl =
    asString(node.canonicalUrl) ?? asString(node.productUrl) ?? asString(node.url);
  const itemId =
    asString(node.usItemId) ??
    asString(node.itemId) ??
    asString(node.id) ??
    asString(node.productId);
  const url = absoluteProductUrl(canonicalUrl, itemId);
  if (!url) return null;

  const wasPrice = wasPriceFromNode(node);

  const image =
    asString(node.image) ??
    asString(node.imageUrl) ??
    asString(node.thumbnailUrl) ??
    undefined;

  // Search payloads sometimes already carry a UPC/GTIN; usually null until the
  // product page is fetched.
  const upcRaw =
    asString(node.upc) ??
    asString(node.gtin13) ??
    asString(node.gtin12) ??
    asString(node.gtin);
  const upc = upcRaw ? normalizeGtin(upcRaw) : null;

  return { title, price, wasPrice, url, upc, ...(image ? { image } : {}) };
}

// Deep-walk a __NEXT_DATA__ blob looking for product-shaped nodes. Each node
// that converts becomes one product; we don't descend into a node that already
// converted (avoids double-counting nested priceInfo shapes).
function walkForProducts(root: unknown, out: SourcedProduct[]): void {
  const seen = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }
    if (!isRecord(cur)) continue;
    const p = nodeToProduct(cur);
    if (p) {
      // Dedupe on URL — payloads sometimes repeat items across stacks.
      if (!seen.has(p.url)) {
        seen.add(p.url);
        out.push(p);
      }
      continue; // don't descend into a converted product node
    }
    for (const key of Object.keys(cur)) stack.push(cur[key]);
  }
}

/** Extract sourced products from a parsed __NEXT_DATA__ JSON blob (or any
 *  search-payload-shaped JSON). Pure function, safe for the offline harness.
 */
export function parseSearchPayload(json: unknown): SourcedProduct[] {
  try {
    const out: SourcedProduct[] = [];
    walkForProducts(json, out);
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// parseUpcFromProductPage
// ---------------------------------------------------------------------------

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const GTIN_KEYS = ["gtin13", "gtin12", "gtin14", "gtin", "upc"];

function normalizeGtin(v: string): string | null {
  const digits = v.replace(/\D/g, "");
  // UPC-A 12, EAN-13, GTIN-14 (and UPC-E-ish 8) are the realistic lengths.
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return null;
}

function findGtin(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const el of node) {
      const hit = findGtin(el);
      if (hit) return hit;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  // Prefer explicit GTIN fields on Product-typed nodes, but accept any node.
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

/** Extract the UPC/GTIN from a Walmart product page's JSON-LD blocks.
 *  Returns the digit-normalized code, or null when absent.
 */
export function parseUpcFromProductPage(html: string): string | null {
  try {
    LD_JSON_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LD_JSON_RE.exec(html)) !== null) {
      const raw = (m[1] ?? "").trim();
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const hit = findGtin(parsed);
        if (hit) return hit;
      } catch {
        // malformed JSON-LD block — try the next one
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// sweepWalmartClearance
// ---------------------------------------------------------------------------

const BLOCKED_BODY_MARKERS = [
  "px-captcha",
  "perimeterx",
  "robot or human",
  "captcha-delivery",
  "are you a robot",
];

function looksBlocked(status: number, body: string): string | null {
  if (status === 403 || status === 429 || status === 503) {
    return `walmart blocked: ${status}`;
  }
  if (body.trim().length === 0) return "walmart blocked: empty response";
  const lower = body.toLowerCase();
  for (const marker of BLOCKED_BODY_MARKERS) {
    if (lower.includes(marker)) return `walmart blocked: captcha (${status})`;
  }
  return null;
}

function extractNextData(html: string): unknown | null {
  const re =
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
  const m = re.exec(html);
  if (!m || !m[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// Fallback 1: JSON-LD blocks on the search page (ItemList / Product nodes).
function productsFromLdJson(html: string): SourcedProduct[] {
  const out: SourcedProduct[] = [];
  try {
    LD_JSON_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LD_JSON_RE.exec(html)) !== null) {
      const raw = (m[1] ?? "").trim();
      if (!raw) continue;
      try {
        walkForProducts(JSON.parse(raw), out);
      } catch {
        // skip malformed block
      }
    }
  } catch {
    // ignore
  }
  return out;
}

// Fallback 2 (last resort): regex over inline product JSON blobs.
// Looks for usItemId anchors, then reads name/price from the surrounding window.
function productsFromRegexBlobs(html: string): SourcedProduct[] {
  const out: SourcedProduct[] = [];
  const seen = new Set<string>();
  try {
    const idRe = /"usItemId"\s*:\s*"?(\d+)"?/g;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(html)) !== null) {
      const itemId = m[1];
      const window = html.slice(Math.max(0, m.index - 1500), m.index + 1500);
      const nameM = /"(?:name|title)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(window);
      const priceM =
        /"currentPrice"\s*:\s*\{\s*"price"\s*:\s*"?([\d.]+)"?/.exec(window) ??
        /"(?:price|salesPrice)"\s*:\s*"?([\d.]+)"?/.exec(window);
      if (!nameM || !priceM) continue;
      const title = nameM[1].replace(/\\"/g, '"').trim();
      const price = asNumber(priceM[1]);
      if (!title || price === null || price <= 0) continue;
      if (JUNK_TITLE_RE.test(title)) continue;
      const url = `${BASE}/ip/${itemId}`;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title, price, wasPrice: null, url, upc: null });
    }
  } catch {
    // ignore
  }
  return out;
}

export async function sweepWalmartClearance(
  opts?: SweepOptions
): Promise<SweepResult> {
  const errors: string[] = [];
  const pushError = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  try {
    const fetchFn = opts?.fetchFn ?? fetch;
    const delayMs = opts?.delayMs ?? 800;
    const fetchUpc = opts?.fetchUpc ?? true;
    const maxUpcFetches = Math.max(0, opts?.maxUpcFetches ?? 25);
    const maxItems = Math.min(
      Math.max(0, opts?.maxItems ?? 50),
      MAX_ITEMS_HARD_CAP
    );

    // --- 1. Fetch the clearance search page ---
    let searchRes: Response;
    try {
      searchRes = await fetchFn(SEARCH_URL, { headers: pageHeaders() });
    } catch (e) {
      return {
        items: [],
        errors: [
          `walmart search failed: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }

    let searchBody = "";
    try {
      searchBody = await searchRes.text();
    } catch (e) {
      pushError(
        `walmart search body unreadable: ${e instanceof Error ? e.message : String(e)}`
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
        errors: [`walmart search failed: http ${searchRes.status}`],
      };
    }

    // --- 2. Parse products: __NEXT_DATA__ first, then fallbacks ---
    let products: SourcedProduct[] = [];
    try {
      const nextData = extractNextData(searchBody);
      if (nextData) products = parseSearchPayload(nextData);
    } catch (e) {
      pushError(
        `next-data parse failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (products.length === 0) {
      try {
        products = productsFromLdJson(searchBody);
      } catch {
        // ignore
      }
    }
    if (products.length === 0) {
      try {
        products = productsFromRegexBlobs(searchBody);
      } catch {
        // ignore
      }
    }

    products = products.slice(0, maxItems);

    // --- 3. Fetch product pages for UPCs (2 at a time, delayMs apart) ---
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
            let res: Response;
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
                pushError(`walmart blocked on product page: ${res.status}`);
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
            try {
              const upc = parseUpcFromProductPage(html);
              if (upc) p.upc = upc;
            } catch (e) {
              pushError(
                `upc parse failed for ${p.url}: ${e instanceof Error ? e.message : String(e)}`
              );
            }
          } catch (e) {
            // Belt-and-braces: per-item work never escapes.
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
// RetailerAdapter implementation (multi-retailer seam — see lib/sourcing/README.md)
// ---------------------------------------------------------------------------

/**
 * Walmart as a RetailerAdapter. The pre-existing sweepWalmartClearance(),
 * SourcedProduct, and parse helpers above are unchanged (other modules and
 * harnesses depend on them); this wrapper only stamps the retailer slug so
 * the item satisfies the shared SourcedCandidate shape.
 */
export const walmartAdapter: RetailerAdapter = {
  slug: "walmart",
  displayName: "Walmart",
  async sweep(opts?: AdapterSweepOptions): Promise<SweepOutcome> {
    const result = await sweepWalmartClearance(opts);
    const items: SourcedCandidate[] = result.items.map((p) => ({
      ...p,
      retailer: "walmart",
    }));
    return { items, errors: result.errors };
  },
};
