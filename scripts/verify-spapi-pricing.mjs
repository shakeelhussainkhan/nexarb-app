// Offline harness for SP-API pricing. Run: node scripts/verify-spapi-pricing.mjs
import { getLiveSellPrice } from "../lib/spapi/pricing.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const cfg = {
  refreshToken: "r", clientId: "c", clientSecret: "s",
  sellerId: "SELLER1", marketplaceId: "ATVPDKIKX0DER",
};

const okFetch = async (url, init) => {
  const u = String(url);
  if (u.includes("api.amazon.com/auth/o2/token")) {
    return { ok: true, json: async () => ({ access_token: "tok" }) };
  }
  if (u.includes("/products/pricing/v0/competitivePrice")) {
    if (init.headers["x-amz-access-token"] !== "tok")
      return { ok: false, status: 401, text: async () => "bad token" };
    return {
      ok: true,
      json: async () => ({
        payload: [{
          status: "Success",
          ASIN: "B004IR3044",
          Product: {
            CompetitivePricing: {
              CompetitivePrices: [
                { Price: { LandedPrice: { Amount: 12.34, CurrencyCode: "USD" } }, subcondition: "New", belongsToRequester: false },
              ],
            },
          },
        }],
      }),
    };
  }
  return { ok: false, status: 404, text: async () => "" };
};

const r = await getLiveSellPrice(cfg, "B004IR3044", okFetch);
check("live price parsed", r.price === 12.34 && r.source === "sp-api-pricing", JSON.stringify(r));

let capturedUrl = "";
const captureFetch = async (url, init) => {
  capturedUrl = String(url);
  return okFetch(url, init);
};
await getLiveSellPrice(cfg, "B004IR3044", captureFetch);
check(
  "uses MarketplaceId + Asins + ItemType params (per official spec)",
  /[?&]Asins=B004IR3044/.test(capturedUrl) && /[?&]MarketplaceId=/.test(capturedUrl) && /[?&]ItemType=Asin/.test(capturedUrl),
  capturedUrl
);

const emptyFetch = async (url, init) => {
  const u = String(url);
  if (u.includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
  return { ok: true, json: async () => ({ payload: [{ status: "Success", Product: { CompetitivePricing: { CompetitivePrices: [] } } }] }) };
};
const r2 = await getLiveSellPrice(cfg, "B004IR3044", emptyFetch);
check("empty prices -> null, not zero", r2.price === null && r2.source === "error");

const errFetch = async (url) => {
  if (String(url).includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
  return { ok: false, status: 403, text: async () => "forbidden" };
};
const r3 = await getLiveSellPrice(cfg, "B004IR3044", errFetch);
check("403 -> null with reason", r3.price === null && /403/.test(r3.reason));

const lwaFail = async () => ({ ok: false, status: 400, text: async () => "bad", json: async () => ({}) });
const r4 = await getLiveSellPrice(cfg, "B004IR3044", lwaFail);
check("LWA failure -> null, never throws", r4.price === null && r4.source === "error");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
