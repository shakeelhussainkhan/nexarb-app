// Offline harness for the retailer adapter seam (lib/sourcing/).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-sourcing-adapters.mjs
import { walmartAdapter } from "../lib/sourcing/walmart.ts";
import { retailerAdapters, getAdapter } from "../lib/sourcing/adapters.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// 1. Walmart implements the adapter contract
check("walmartAdapter slug", walmartAdapter.slug === "walmart");
check("walmartAdapter displayName", walmartAdapter.displayName === "Walmart");
check("walmartAdapter.sweep is a function", typeof walmartAdapter.sweep === "function");

// 2. Adapter stamps the retailer slug onto candidates (injected fetch, no network)
const fixturePayload = {
  props: {
    pageProps: {
      initialData: {
        searchResult: {
          itemStacks: [
            {
              itemsV2: [
                {
                  name: "Test Widget",
                  priceInfo: { currentPrice: { price: 9.99 } },
                  canonicalUrl: "/ip/12345",
                  usItemId: "12345",
                },
              ],
            },
          ],
        },
      },
    },
  },
};
const searchHtml = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixturePayload)}</script></head><body></body></html>`;
const stubFetch = async (url) => {
  if (String(url).includes("/search")) {
    return { ok: true, status: 200, text: async () => searchHtml };
  }
  return { ok: false, status: 404, text: async () => "" };
};
const out = await walmartAdapter.sweep({ maxItems: 5, fetchUpc: false, fetchFn: stubFetch, delayMs: 0 });
check("adapter sweep returns items", out.items.length === 1, JSON.stringify(out).slice(0, 200));
check("adapter stamps retailer=walmart", out.items[0]?.retailer === "walmart");
check("adapter never throws (errors array present)", Array.isArray(out.errors));

// 3. Registry
check("registry includes walmart", retailerAdapters.some((a) => a.slug === "walmart"));
check("getAdapter('walmart') resolves", getAdapter("walmart") === walmartAdapter);
check("getAdapter unknown slug -> undefined", getAdapter("target") === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
