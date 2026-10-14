// Offline harness for catalog product display info (migration 017):
// the pure mapper (lib/sourcing/catalogProductCore.ts), its wiring in
// lib/sourcing/match.ts (pickBestAsin / parseCatalogTitleItems /
// getCatalogProductByAsin), and the title-match passthrough.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-catalog-product.mjs
// NO network (all fetch injected), NO database.
import {
  mapCatalogItem,
  mapFirstCatalogItem,
  pickCatalogImageUrl,
} from "../lib/sourcing/catalogProductCore.ts";
import {
  pickBestAsin,
  parseCatalogTitleItems,
  getCatalogProductByAsin,
} from "../lib/sourcing/match.ts";
import { pickTitleMatch } from "../lib/sourcing/titleMatchCore.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// Fixture mirroring a real Catalog Items v2022-04-01 item.
const item = {
  asin: "B004IR3044",
  summaries: [
    { itemName: "Scotch-Brite Heavy Duty Scrub Sponge, 6 Count", brand: "Scotch-Brite", manufacturer: "3M", marketplaceId: "ATVPDKIKX0DER" },
  ],
  images: [
    {
      marketplaceId: "ATVPDKIKX0DER",
      images: [
        { variant: "PT01", link: "https://m.media-amazon.com/images/I/pt01.jpg", width: 1000, height: 1000 },
        { variant: "MAIN", link: "https://m.media-amazon.com/images/I/main-small.jpg", width: 500, height: 500 },
        { variant: "MAIN", link: "https://m.media-amazon.com/images/I/main-large.jpg", width: 1500, height: 1500 },
      ],
    },
  ],
};

// --- mapCatalogItem ---
{
  const info = mapCatalogItem(item);
  check("mapCatalogItem: title from summaries[0].itemName",
    info !== null && info.title === "Scotch-Brite Heavy Duty Scrub Sponge, 6 Count", JSON.stringify(info));
  check("mapCatalogItem: brand wins over manufacturer",
    info !== null && info.brand === "Scotch-Brite", JSON.stringify(info));
  check("mapCatalogItem: widest MAIN image chosen (not wider PT variant)",
    info !== null && info.imageUrl === "https://m.media-amazon.com/images/I/main-large.jpg", JSON.stringify(info));
}
{
  const info = mapCatalogItem({ summaries: [{ itemName: "X", manufacturer: "3M" }] });
  check("mapCatalogItem: brand falls back to manufacturer",
    info !== null && info.brand === "3M" && info.imageUrl === null, JSON.stringify(info));
}
check("mapCatalogItem: no images -> imageUrl null, title kept",
  (() => { const i = mapCatalogItem({ summaries: [{ itemName: "Y" }] }); return i !== null && i.title === "Y" && i.imageUrl === null; })());
check("mapCatalogItem: empty/malformed -> null",
  mapCatalogItem({}) === null && mapCatalogItem(null) === null &&
  mapCatalogItem("garbage") === null && mapCatalogItem({ summaries: [] }) === null);

// --- pickCatalogImageUrl ---
check("image pick: no MAIN -> widest overall",
  pickCatalogImageUrl([{ images: [
    { variant: "PT01", link: "https://x/a.jpg", width: 200 },
    { variant: "PT02", link: "https://x/b.jpg", width: 800 },
  ] }]) === "https://x/b.jpg");
check("image pick: non-http links ignored",
  pickCatalogImageUrl([{ images: [{ variant: "MAIN", link: "ftp://x/a.jpg", width: 10 }] }]) === null);
check("image pick: malformed -> null",
  pickCatalogImageUrl(null) === null && pickCatalogImageUrl([{ images: "no" }]) === null);

// --- mapFirstCatalogItem ---
{
  const first = mapFirstCatalogItem({ items: [{ summaries: [{ itemName: "No ASIN" }] }, item] });
  check("mapFirstCatalogItem: skips ASIN-less items, maps first with ASIN",
    first !== null && first.asin === "B004IR3044" && first.brand === "Scotch-Brite", JSON.stringify(first));
  check("mapFirstCatalogItem: empty/malformed -> null",
    mapFirstCatalogItem({ items: [] }) === null && mapFirstCatalogItem(null) === null);
}

// --- match.ts wiring ---
{
  const m = pickBestAsin({ items: [item] });
  check("pickBestAsin carries title + brand + imageUrl",
    m !== null && m.asin === "B004IR3044" && m.brand === "Scotch-Brite" &&
    m.imageUrl === "https://m.media-amazon.com/images/I/main-large.jpg", JSON.stringify(m));
}
{
  const rows = parseCatalogTitleItems({ items: [item] });
  check("parseCatalogTitleItems carries brand + imageUrl",
    rows.length === 1 && rows[0].brand === "Scotch-Brite" &&
    rows[0].imageUrl === "https://m.media-amazon.com/images/I/main-large.jpg", JSON.stringify(rows));
}
{
  const d = pickTitleMatch("Scotch-Brite Heavy Duty Scrub Sponges, 6 Count", [
    { asin: "B004IR3044", title: "Scotch-Brite Heavy Duty Scrub Sponge, 6 Count", brand: "Scotch-Brite", imageUrl: "https://m.media-amazon.com/images/I/main-large.jpg" },
  ]);
  check("pickTitleMatch pick carries brand + imageUrl",
    d.match !== null && d.match.brand === "Scotch-Brite" &&
    d.match.imageUrl === "https://m.media-amazon.com/images/I/main-large.jpg", JSON.stringify(d));
}

// --- getCatalogProductByAsin (injected fetch, no network) ---
const cfg = {
  refreshToken: "r", clientId: "c", clientSecret: "s",
  sellerId: "SELLER1", marketplaceId: "ATVPDKIKX0DER",
};
const throwingFetch = async () => { throw new Error("network must not be used"); };
{
  const r = await getCatalogProductByAsin(null, "B004IR3044", throwingFetch);
  check("getItem: null cfg -> null-with-reason, no network",
    r.product === null && r.reason === "SP-API not configured", JSON.stringify(r));
  const bad = await getCatalogProductByAsin(cfg, "short", throwingFetch);
  check("getItem: invalid ASIN rejected before network",
    bad.product === null && bad.reason === "invalid ASIN format", JSON.stringify(bad));
}
{
  let capturedUrl = "";
  const okFetch = async (url, init) => {
    const u = String(url);
    if (u.includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
    capturedUrl = u;
    if (init.headers["x-amz-access-token"] !== "tok") return { ok: false, status: 401, text: async () => "bad token" };
    return { ok: true, json: async () => item }; // getItem returns the item itself
  };
  const r = await getCatalogProductByAsin(cfg, "B004IR3044", okFetch);
  check("getItem: success maps display facts",
    r.product !== null && r.product.asin === "B004IR3044" &&
    r.product.title === item.summaries[0].itemName && r.product.brand === "Scotch-Brite" &&
    r.product.imageUrl === "https://m.media-amazon.com/images/I/main-large.jpg", JSON.stringify(r));
  check("getItem: URL is items/{asin} with includedData=summaries,images",
    /\/catalog\/2022-04-01\/items\/B004IR3044/.test(capturedUrl) &&
    /[?&]includedData=summaries,images/.test(capturedUrl), capturedUrl);
}
{
  const forbiddenFetch = async (url) => {
    if (String(url).includes("api.amazon.com")) return { ok: true, json: async () => ({ access_token: "tok" }) };
    return { ok: false, status: 403, text: async () => "forbidden" };
  };
  let threw = false;
  let r = null;
  try { r = await getCatalogProductByAsin(cfg, "B004IR3044", forbiddenFetch); } catch { threw = true; }
  check("getItem: 403 -> null-with-reason, no throw",
    !threw && r !== null && r.product === null && /403/.test(r.reason), JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
