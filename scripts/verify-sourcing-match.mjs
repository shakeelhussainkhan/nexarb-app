// Offline harness for the UPC->ASIN matcher. NO network: all fetch calls are injected.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-sourcing-match.mjs
import { matchUpcToAsin, pickBestAsin } from "../lib/sourcing/match.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const cfg = {
  refreshToken: "r", clientId: "c", clientSecret: "s",
  sellerId: "SELLER1", marketplaceId: "ATVPDKIKX0DER",
};

// Fixture mirroring a real Catalog Items v2022-04-01 searchByIdentifiers body.
const fixture = {
  items: [
    {
      asin: "B004IR3044",
      attributes: { item_name: [{ value: "Fixture Product" }] },
      identifiers: [{ identifiersType: "UPC", identifiers: [{ identifier: "044500027852" }] }],
      summaries: [{ itemName: "Fixture Product (2-Pack)", marketplaceId: "ATVPDKIKX0DER" }],
    },
    { asin: "B000000001", summaries: [{ itemName: "Second Item" }] },
  ],
  pagination: {},
};

const m1 = pickBestAsin(fixture);
check("pickBestAsin extracts asin+title from fixture",
  m1 !== null && m1.asin === "B004IR3044" && m1.title === "Fixture Product (2-Pack)", JSON.stringify(m1));

check("pickBestAsin returns null on empty items", pickBestAsin({ items: [] }) === null);

check("pickBestAsin returns null when no item has an ASIN",
  pickBestAsin({ items: [{ summaries: [{ itemName: "No ASIN" }] }] }) === null);

check("pickBestAsin returns null on malformed payload",
  pickBestAsin(null) === null && pickBestAsin({}) === null && pickBestAsin("garbage") === null);

// Null cfg must resolve to null-with-reason without touching the network.
const throwingFetch = async () => { throw new Error("network must not be used"); };
const rNull = await matchUpcToAsin(null, "044500027852", throwingFetch);
check("null cfg -> null-with-reason, no network",
  rNull.match === null && rNull.reason === "SP-API not configured", JSON.stringify(rNull));

// Invalid UPCs rejected before any network use.
const rBad = await matchUpcToAsin(cfg, "ABC-12", throwingFetch);
check("invalid UPC rejected (non-digit)", rBad.match === null && rBad.reason === "invalid UPC format", JSON.stringify(rBad));
const rShort = await matchUpcToAsin(cfg, "12345", throwingFetch);
check("invalid UPC rejected (bad length)", rShort.match === null && rShort.reason === "invalid UPC format", JSON.stringify(rShort));

// 403 (app lacks Catalog role) resolves to null-with-reason mentioning 403, no throw.
const forbiddenFetch = async (url) => {
  const u = String(url);
  if (u.includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
  return { ok: false, status: 403, text: async () => JSON.stringify({ errors: [{ code: "Unauthorized", message: "Access to the resource is forbidden" }] }) };
};
let threw = false;
let r403 = null;
try { r403 = await matchUpcToAsin(cfg, "044500027852", forbiddenFetch); }
catch { threw = true; }
check("403 -> null-with-reason, no throw",
  !threw && r403 !== null && r403.match === null && /403/.test(r403.reason), JSON.stringify(r403));

// Success path: correct URL shape, token header, UPC normalized (spaces/dashes stripped).
let capturedUrl = "";
const okFetch = async (url, init) => {
  const u = String(url);
  if (u.includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
  capturedUrl = u;
  if (init.headers["x-amz-access-token"] !== "tok") return { ok: false, status: 401, text: async () => "bad token" };
  return { ok: true, json: async () => fixture };
};
const rOk = await matchUpcToAsin(cfg, " 044-5000 27852 ", okFetch);
check("success path resolves match",
  rOk.match !== null && rOk.match.asin === "B004IR3044" && typeof rOk.reason === "string", JSON.stringify(rOk));
check("uses catalog/2022-04-01/items with identifiersType=UPC + normalized UPC",
  /\/catalog\/2022-04-01\/items/.test(capturedUrl) &&
    /[?&]identifiersType=UPC/.test(capturedUrl) &&
    /[?&]identifiers=044500027852/.test(capturedUrl) &&
    /[?&]marketplaceIds=ATVPDKIKX0DER/.test(capturedUrl),
  capturedUrl);

// LWA token-exchange failure resolves to null-with-reason, no throw.
const tokenFailFetch = async (url) => {
  if (String(url).includes("api.amazon.com")) return { ok: false, status: 400, text: async () => "bad grant" };
  return { ok: false, status: 500, text: async () => "" };
};
const rTok = await matchUpcToAsin(cfg, "044500027852", tokenFailFetch);
check("token exchange failure -> null-with-reason",
  rTok.match === null && /failed/.test(rTok.reason), JSON.stringify(rTok));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
