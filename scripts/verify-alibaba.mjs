// Offline harness for the Alibaba core (lib/alibaba/core.ts).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-alibaba.mjs
// Pure-logic tests — NO network, NO database, fake secret only.
import { createHmac } from "node:crypto";
import {
  alibabaConfigFromEnv,
  alibabaRedirectUri,
  describeShape,
  buildStringToSign,
  signRequest,
  parseSearchResults,
  parseProductDescription,
  ladderPriceFor,
  bestLandedCost,
} from "@/lib/alibaba/core.ts";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

// --- config ---
check("config: missing secret -> null", alibabaConfigFromEnv({ ALIBABA_APP_KEY: "502684" }) === null);
check("config: key+secret -> config with defaults",
  (() => { const c = alibabaConfigFromEnv({ ALIBABA_APP_KEY: "502684", ALIBABA_APP_SECRET: "s3cr3t" }); return c?.appKey === "502684" && c.apiBase.length > 0 && c.authBase.includes("openapi-auth"); })());
check("config: env base override wins",
  alibabaConfigFromEnv({ ALIBABA_APP_KEY: "k", ALIBABA_APP_SECRET: "s", ALIBABA_API_BASE: "https://gw.example.com/" })?.apiBase === "https://gw.example.com");
check("redirect uri: production default",
  alibabaRedirectUri({}) === "https://app.nexarb.io/api/alibaba/callback");
check("redirect uri: app url override",
  alibabaRedirectUri({ NEXT_PUBLIC_APP_URL: "https://staging.example.com/" }) === "https://staging.example.com/api/alibaba/callback");
check("config: default gateway is the IOP /rest endpoint from Alibaba's SDK",
  alibabaConfigFromEnv({ ALIBABA_APP_KEY: "k", ALIBABA_APP_SECRET: "s" })?.apiBase === "https://openapi-api.alibaba.com/rest");

// --- signing ---
{
  const params = { b: "2", a: "1", sign: "IGNORED", app_key: "502684" };
  const sts = buildStringToSign("/eco/buyer/product/search", params);
  check("string-to-sign: path + sorted pairs, sign excluded",
    sts === "/eco/buyer/product/searcha1app_key502684b2", sts);
  const expected = createHmac("sha256", "s3cr3t").update(sts, "utf8").digest("hex").toUpperCase();
  check("signature: HMAC-SHA256 uppercase hex of the string-to-sign",
    signRequest("s3cr3t", "/eco/buyer/product/search", params) === expected);
  check("signature: param order in the object does not matter",
    signRequest("s3cr3t", "/x", { a: "1", b: "2" }) === signRequest("s3cr3t", "/x", { b: "2", a: "1" }));
}

// --- search parsing ---
{
  const hits = parseSearchResults({
    result: {
      data: [
        { product_id: 12345, title: "LED Strip Lights 5m", main_image: "https://img/1.jpg", detail_url: "https://www.alibaba.com/product-detail/1" },
        { productId: "6789", subject: "Silicone Spatula Set" },
        { title: "no id — skipped" },
        null,
      ],
      total: 3,
    },
  });
  check("search parse: data variant, ids stringified, junk skipped",
    hits.length === 2 && hits[0].productId === "12345" && hits[1].title === "Silicone Spatula Set",
    JSON.stringify(hits));
  check("search parse: productList variant",
    parseSearchResults({ result: { productList: [{ id: 1, title: "X" }] } }).length === 1);
  check("search parse: junk -> []",
    parseSearchResults(null).length === 0 && parseSearchResults({ result: {} }).length === 0);
}

// --- description parsing + landed cost ---
const DETAIL_PAYLOAD = {
  result: {
    result_data: {
      product_id: 12345,
      title: "LED Strip Lights 5m RGB",
      detail_url: "https://www.alibaba.com/product-detail/1",
      main_image: "https://img/1.jpg",
      min_order_quantity: 100,
      currency: "USD",
      supplier: { company_name: "Shenzhen Bright Co." },
      skus: [
        {
          sku_id: "S1",
          ladder_price: [
            { min_order_quantity: 100, price: 2.4 },
            { min_order_quantity: 500, price: 2.1 },
            { min_order_quantity: 1000, price: 1.9 },
          ],
          cost_origin_price: 2.6,
          cost_discount_price: 2.4,
          shipping_fee: 60,
          cost_price_currency: "USD",
        },
        {
          sku_id: "S2",
          ladder_price: [],
          cost_origin_price: 3.1,
          cost_discount_price: null,
          shipping_fee: 0,
          cost_price_currency: "USD",
        },
      ],
    },
  },
};
{
  const detail = parseProductDescription(DETAIL_PAYLOAD);
  check("description parse: core fields",
    detail?.productId === "12345" && detail?.moq === 100 && detail?.supplierName === "Shenzhen Bright Co." && detail?.skus.length === 2,
    JSON.stringify(detail?.productId));
  check("description parse: junk -> null", parseProductDescription({ result: {} }) === null);

  check("ladder: deepest reached tier wins",
    ladderPriceFor(detail.skus[0].ladder, 600) === 2.1 && ladderPriceFor(detail.skus[0].ladder, 50) === 2.4);

  // qty 10 requested but MOQ 100 -> order 100 @ $2.40 + $60/100 shipping = $3.00
  const landed = bestLandedCost(detail, 10);
  check("landed: MOQ lifts order qty, shipping amortized, cheapest SKU picked",
    landed?.skuId === "S1" && landed?.orderQty === 100 && landed?.landedPerUnit === 3.0,
    JSON.stringify(landed));
  // qty 1000 -> tier $1.90 + $60/1000 = $1.96
  const bulk = bestLandedCost(detail, 1000);
  check("landed: bulk tier lowers unit cost",
    bulk?.landedPerUnit === 1.96, JSON.stringify(bulk));
}

// --- shape diagnostics ---
{
  const shape = describeShape({ result: { data: [{ product_id: 1, title: "x", price: 2 }], total: 42, current: 1 } });
  check("shape: keys + total extracted",
    shape.total === 42 && shape.resultKeys.includes("data") && shape.firstItemKeys.includes("product_id"),
    JSON.stringify(shape));
  check("shape: junk -> empty summary",
    describeShape(null).total === null && describeShape(null).topKeys.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
