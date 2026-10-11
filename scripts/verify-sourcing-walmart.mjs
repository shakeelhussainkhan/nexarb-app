// Offline harness for the Walmart clearance sourcing module.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-sourcing-walmart.mjs
// Pure-logic tests with fixture data — NO network.
import {
  parseSearchPayload,
  parseUpcFromProductPage,
  sweepWalmartClearance,
} from "@/lib/sourcing/walmart.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// --- Fixture: __NEXT_DATA__ blob shaped like Walmart's search page ---
const NEXT_DATA_FIXTURE = {
  props: {
    pageProps: {
      initialData: {
        searchResult: {
          itemStacks: [
            {
              itemsV2: [
                {
                  name: "Mainstays 10x10 ft Pop-Up Canopy",
                  priceInfo: {
                    currentPrice: { price: 89.99 },
                    wasPrice: { price: 149.99 },
                  },
                  canonicalUrl: "/ip/Mainstays-10x10-ft-Pop-Up-Canopy/12345678",
                  usItemId: "12345678",
                  imageUrl: "https://i5.walmartimages.com/asr/x.jpg",
                },
                {
                  name: "Ozark Trail 4-Person Tent",
                  priceInfo: { currentPrice: { price: 74.0 } },
                  canonicalUrl: "/ip/Ozark-Trail-4-Person-Tent/23456789",
                  usItemId: "23456789",
                  upc: "076501234567",
                },
                {
                  // junk: gift cards must be skipped
                  name: "Walmart $25 Gift Card",
                  priceInfo: { currentPrice: { price: 25 } },
                  canonicalUrl: "/ip/Walmart-Gift-Card/87654321",
                  usItemId: "87654321",
                },
                {
                  // junk: zero price must be skipped
                  name: "Broken Widget",
                  priceInfo: { currentPrice: { price: 0 } },
                  canonicalUrl: "/ip/Broken-Widget/11111111",
                  usItemId: "11111111",
                },
              ],
            },
          ],
        },
      },
    },
  },
};

const parsed = parseSearchPayload(NEXT_DATA_FIXTURE);
check(
  "parseSearchPayload: extracts 2 products (gift card + zero-price filtered)",
  parsed.length === 2,
  `got ${parsed.length}`
);
check(
  "parseSearchPayload: title/price/wasPrice",
  parsed[0].title === "Mainstays 10x10 ft Pop-Up Canopy" &&
    parsed[0].price === 89.99 &&
    parsed[0].wasPrice === 149.99,
  JSON.stringify(parsed[0])
);
check(
  "parseSearchPayload: absolute walmart.com URL",
  parsed[0].url ===
    "https://www.walmart.com/ip/Mainstays-10x10-ft-Pop-Up-Canopy/12345678",
  parsed[0].url
);
check(
  "parseSearchPayload: upc from payload kept, null when absent",
  parsed[0].upc === null && parsed[1].upc === "076501234567",
  JSON.stringify(parsed.map((p) => p.upc))
);

// --- Fixture: product page with JSON-LD ---
const PRODUCT_HTML = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","name":"Walmart"}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org/","@type":"Product",
 "name":"Mainstays 10x10 ft Pop-Up Canopy",
 "gtin13":"006789123456",
 "offers":{"@type":"Offer","price":"89.99","priceCurrency":"USD"}}
</script>
</head><body></body></html>`;

check(
  "parseUpcFromProductPage: extracts gtin13 from JSON-LD",
  parseUpcFromProductPage(PRODUCT_HTML) === "006789123456",
  parseUpcFromProductPage(PRODUCT_HTML)
);
check(
  "parseUpcFromProductPage: null when no JSON-LD present",
  parseUpcFromProductPage("<html><body>no data</body></html>") === null
);

// --- sweep with a failing injected fetch: never throws, clean zero ---
const throwingFetch = async () => {
  throw new Error("socket hang up");
};
let threw = false;
let failResult = null;
try {
  failResult = await sweepWalmartClearance({
    fetchFn: throwingFetch,
    delayMs: 1,
    fetchUpc: false,
  });
} catch {
  threw = true;
}
check("sweep: never throws on failing fetch", !threw);
check(
  "sweep: failing fetch -> empty items + non-empty errors",
  failResult !== null &&
    failResult.items.length === 0 &&
    failResult.errors.length > 0,
  JSON.stringify(failResult)
);

// --- sweep: blocked (403) -> clean zero with blocked error ---
const blockedFetch = async () => ({ ok: false, status: 403, text: async () => "" });
const blocked = await sweepWalmartClearance({ fetchFn: blockedFetch, delayMs: 1 });
check(
  "sweep: 403 -> items [] with blocked error",
  blocked.items.length === 0 && /blocked: 403/.test(blocked.errors.join(" ")),
  JSON.stringify(blocked.errors)
);

// --- sweep end-to-end with a mock success fetch (no real network) ---
const searchHtml = `<html><head>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(NEXT_DATA_FIXTURE)}</script>
</head><body></body></html>`;
const mockFetch = async (url) => {
  if (String(url).includes("/search")) {
    return { ok: true, status: 200, text: async () => searchHtml };
  }
  return { ok: true, status: 200, text: async () => PRODUCT_HTML };
};
const ok = await sweepWalmartClearance({
  fetchFn: mockFetch,
  delayMs: 1,
  maxItems: 1,
  maxUpcFetches: 1,
});
check(
  "sweep: mock search -> 1 item parsed",
  ok.items.length === 1 && ok.items[0].price === 89.99,
  JSON.stringify(ok.items)
);
check(
  "sweep: UPC fetched from product page",
  ok.items.length === 1 && ok.items[0].upc === "006789123456",
  JSON.stringify(ok.items.map((i) => i.upc))
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
