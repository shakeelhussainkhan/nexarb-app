// Offline harness for the deal details feature: the shared deal mapping
// (lib/engine/dealCore.ts — extracted from GET /api/deals so the list and
// the per-ASIN detail route compute identically) and the pure detail
// aggregation (lib/engine/dealDetailCore.ts).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-deal-detail.mjs
// NO network, NO database.
import { dealFromCheckRow } from "../lib/engine/dealCore.ts";
import {
  recentCheckFromRow,
  buyBoxWinner,
  buyBoxObservationsFromRows,
  approvalInfoFromRow,
  retailerLabelFromBuySource,
  buildDealDetail,
} from "../lib/engine/dealDetailCore.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const baseRow = {
  id: 42,
  asin: "B0DT4W7FP3",
  qty: 10,
  buy_price: 10,
  buy_source: "walmart.com",
  sell_price: 26.99,
  sell_price_source: "sp-api-pricing",
  eligibility: "APPROVAL_REQUIRED",
  verdict: "BUY",
  verdict_reasons: ["Channel chosen: amazon-fba — best net profit ($5.99/unit) among BUY-eligible channels."],
  floor_price: 24.48,
  net_profit: 5.99,
  margin_pct: 22.2,
  checked_at: "2026-10-14T15:58:00.000Z",
};

// --- dealFromCheckRow: sp-api-priced BUY row ---
{
  const d = dealFromCheckRow(baseRow);
  check("deal: identity + prices mapped",
    d.asin === "B0DT4W7FP3" && d.buyPrice === 10 && d.sellPrice === 26.99 &&
    d.profit === 5.99 && d.margin === 22.2 && d.engine.floorPrice === 24.48,
    JSON.stringify(d));
  check("deal: title defaults to ASIN, brand/image null (enrichment layers on later)",
    d.title === "B0DT4W7FP3" && d.brand === null && d.imageUrl === null);
  check("deal: amazon channel carries the row numbers, verdict BUY",
    d.engine.channels[0].channel === "amazon-fba" && d.engine.channels[0].sellPrice === 26.99 &&
    d.engine.channels[0].netProfit === 5.99 && d.engine.channels[0].verdict === "BUY",
    JSON.stringify(d.engine.channels));
  check("deal: walmart channel unavailable/UNKNOWN (no competitive pricing source)",
    d.engine.channels[1].channel === "walmart-wfs" && d.engine.channels[1].sellPrice === null &&
    d.engine.channels[1].sellPriceSource === "unavailable" && d.engine.channels[1].verdict === "UNKNOWN");
  check("deal: chosenChannel amazon-fba for sp-api BUY",
    d.engine.chosenChannel === "amazon-fba");
  check("deal: verifiedPrice + High confidence + Walmart channel label",
    d.verifiedPrice === true && d.confidence === "High" && d.channel === "Walmart" &&
    d.category === "APPROVAL_REQUIRED" && d.engine.suggestedQty === 10);
  check("deal: velocity placeholder is honest insufficient-data",
    d.engine.velocity.unitsPerDay === null && d.engine.velocity.basis === "insufficient data" && d.bsr === 0);
  check("deal: trust assessed from buy_source",
    typeof d.trust.level === "string" && Array.isArray(d.trust.notes));
}

// --- dealFromCheckRow: unpriced row ---
{
  const d = dealFromCheckRow({
    ...baseRow,
    sell_price: null,
    sell_price_source: "unknown",
    eligibility: "UNKNOWN",
    verdict: "UNKNOWN",
    net_profit: null,
    margin_pct: null,
    floor_price: null,
  });
  check("deal: null sell price -> 0 with both channels UNKNOWN and no chosen channel",
    d.sellPrice === 0 && d.engine.channels[0].verdict === "UNKNOWN" &&
    d.engine.channels[1].verdict === "UNKNOWN" && d.engine.chosenChannel === null &&
    d.verifiedPrice === false && d.confidence === "Low",
    JSON.stringify(d.engine.channels));
}

// --- dealFromCheckRow: walmart-priced SKIP row + numeric strings ---
{
  const d = dealFromCheckRow({
    ...baseRow,
    buy_price: "283.97",
    sell_price: "199.99",
    sell_price_source: "walmart-seller",
    verdict: "SKIP",
    net_profit: "-10.50",
    margin_pct: "-5.3",
    floor_price: "210.00",
  });
  check("deal: numeric strings coerced",
    d.buyPrice === 283.97 && d.sellPrice === 199.99 && d.profit === -10.5 && d.engine.floorPrice === 210,
    JSON.stringify({ buy: d.buyPrice, sell: d.sellPrice, profit: d.profit }));
  check("deal: walmart channel carries numbers on walmart-priced rows; SKIP keeps chosenChannel null",
    d.engine.channels[1].sellPrice === 199.99 && d.engine.channels[1].verdict === "SKIP" &&
    d.engine.channels[0].sellPrice === null && d.engine.chosenChannel === null,
    JSON.stringify(d.engine.channels));
}

// --- dealFromCheckRow: verdict coercion ---
{
  const d = dealFromCheckRow({ ...baseRow, verdict: "MAYBE" });
  check("deal: unrecognized verdict coerces to UNKNOWN everywhere",
    d.engine.verdict === "UNKNOWN" && d.engine.channels[0].verdict === "UNKNOWN");
}

// --- recentCheckFromRow ---
{
  const c = recentCheckFromRow({
    buy_price: "10.00", sell_price: null, verdict: "SKIP", eligibility: "APPROVAL_REQUIRED",
    net_profit: null, margin_pct: "22.2", floor_price: 24.48, checked_at: "2026-10-14T00:00:00.000Z",
  });
  check("recentCheck: coercions + null preservation",
    c.buyPrice === 10 && c.sellPrice === null && c.netProfit === null &&
    c.marginPct === 22.2 && c.floorPrice === 24.48 && c.verdict === "SKIP" &&
    c.eligibility === "APPROVAL_REQUIRED" && c.checkedAt.startsWith("2026-10-14"),
    JSON.stringify(c));
}

// --- buybox helpers ---
check("buyBoxWinner: us/competitor pass, anything else unknown",
  buyBoxWinner("us") === "us" && buyBoxWinner("competitor") === "competitor" &&
  buyBoxWinner("amazon") === "unknown" && buyBoxWinner(null) === "unknown" && buyBoxWinner(undefined) === "unknown");
{
  const obs = buyBoxObservationsFromRows([
    { checked_at: "2026-10-13T00:00:00.000Z", sell_price: "26.99", buybox_winner: "us" },
    { checked_at: "2026-10-14T00:00:00.000Z", sell_price: null, buybox_winner: null },
  ]);
  check("buybox observations: mapped oldest-first with null price kept",
    obs.length === 2 && obs[0].winner === "us" && obs[0].sellPrice === 26.99 &&
    obs[1].winner === "unknown" && obs[1].sellPrice === null,
    JSON.stringify(obs));
}

// --- approvalInfoFromRow ---
check("approval: null row -> null", approvalInfoFromRow(null) === null && approvalInfoFromRow(undefined) === null);
{
  const a = approvalInfoFromRow({
    status: "applied", approval_url: "https://sellercentral.amazon.com/approval/1",
    channel: "amazon-fba", net_per_unit: "5.99", margin_pct: "22.2",
    buy_price: 10, sell_price: null,
    first_seen_at: "2026-10-13T00:00:00.000Z", last_seen_at: "2026-10-14T00:00:00.000Z",
  });
  check("approval: camelCased with coercions",
    a !== null && a.status === "applied" && a.netPerUnit === 5.99 && a.marginPct === 22.2 &&
    a.buyPrice === 10 && a.sellPrice === null && a.approvalUrl.includes("sellercentral"),
    JSON.stringify(a));
  const b = approvalInfoFromRow({
    status: "weird", approval_url: "https://x", channel: "amazon-fba",
    net_per_unit: 1, margin_pct: 30, buy_price: null, sell_price: null,
    first_seen_at: "2026-10-13T00:00:00.000Z", last_seen_at: "2026-10-13T00:00:00.000Z",
  });
  check("approval: unknown status coerces to pending",
    b !== null && b.status === "pending");
}

// --- retailerLabelFromBuySource ---
check("retailer labels",
  retailerLabelFromBuySource("walmart.com") === "Walmart" &&
  retailerLabelFromBuySource("walmart-clearance") === "Walmart" &&
  retailerLabelFromBuySource("target.com") === "Target" &&
  retailerLabelFromBuySource("costco.com") === "Costco" &&
  retailerLabelFromBuySource("alibaba") === "Alibaba" &&
  retailerLabelFromBuySource("founder-supplied") === "Manual");

// --- buildDealDetail ---
{
  const watchlist = {
    asin: "B0DT4W7FP3", discoveryTitle: "Carter's pajamas", buyPrice: 10,
    buySource: "walmart.com", category: null, active: true,
    addedAt: "2026-10-13T00:00:00.000Z", sourceUrl: "https://www.walmart.com/ip/123",
    productTitle: "Carter's Toddler Girls 4-Piece Pajama Set", productBrand: "Carter's",
    productImageUrl: "https://m.media-amazon.com/images/I/x.jpg",
  };
  const detail = buildDealDetail({
    asin: "B0DT4W7FP3",
    watchlist,
    deal: dealFromCheckRow(baseRow),
    latestEligibility: "APPROVAL_REQUIRED",
    recentCheckRows: [baseRow],
    buyboxRows: [{ checked_at: baseRow.checked_at, sell_price: 26.99, buybox_winner: "competitor" }],
    approvalRow: null,
    latestBuySource: "walmart.com",
  });
  check("detail: watchlist source wins, with URL + label",
    detail.onWatchlist === true && detail.source !== null &&
    detail.source.sourceUrl === "https://www.walmart.com/ip/123" &&
    detail.source.retailerLabel === "Walmart",
    JSON.stringify(detail.source));
  check("detail: eligibility + checks + buybox assembled",
    detail.eligibility === "APPROVAL_REQUIRED" && detail.recentChecks.length === 1 &&
    detail.buybox.length === 1 && detail.buybox[0].winner === "competitor" &&
    detail.approval === null && detail.deal !== null);
}
{
  const detail = buildDealDetail({
    asin: "B000000000",
    watchlist: null,
    deal: null,
    latestEligibility: null,
    recentCheckRows: [],
    buyboxRows: [],
    approvalRow: null,
    latestBuySource: "founder-supplied",
  });
  check("detail: no watchlist -> source falls back to latest check, eligibility UNKNOWN",
    detail.onWatchlist === false && detail.deal === null &&
    detail.eligibility === "UNKNOWN" && detail.source !== null &&
    detail.source.sourceUrl === null && detail.source.retailerLabel === "Manual",
    JSON.stringify(detail));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
