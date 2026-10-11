// Offline harness for the first-party data pipeline (Phase 0).
// Run: node scripts/verify-data-pipeline.mjs
// (Node >= 23 strips the TS types in lib/data/*.ts and lib/engine/*.ts automatically.)
import { ManualOfferAdapter, WalmartStubScanner } from "../lib/data/scanner.ts";
import { InMemorySnapshotStore } from "../lib/data/store.ts";
import { FixtureCollector } from "../lib/data/market.ts";
import {
  rankDrops,
  averageBsr,
  priceMedians,
  snapshotsToVelocitySignals,
  legacyKeepaSignalsToSnapshots,
  estimateVelocity,
} from "../lib/engine/velocity.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const offer = {
  retailer: "walmart",
  url: "https://www.walmart.com/ip/12345",
  title: "Test Widget",
  price: 8.0,
  currency: "USD",
  stockState: "in-stock",
  promo: null,
  upc: "012345678905",
  asin: "B012345678",
  capturedAt: "2026-10-10T12:00:00.000Z",
  matchConfidence: 0.9,
};

const series = [
  { asin: "B012345678", marketplace: "amazon", price: 22, buyBoxPrice: 22, offerCount: 3, salesRank: 100, category: "Beauty", boughtPastMonth: 100, capturedAt: "2026-10-01T00:00:00.000Z" },
  { asin: "B012345678", marketplace: "amazon", price: 21, buyBoxPrice: 21, offerCount: 3, salesRank: 90, category: "Beauty", boughtPastMonth: 100, capturedAt: "2026-10-05T00:00:00.000Z" },
  { asin: "B012345678", marketplace: "amazon", price: 23, buyBoxPrice: 23, offerCount: 4, salesRank: 120, category: "Beauty", boughtPastMonth: 100, capturedAt: "2026-10-08T00:00:00.000Z" },
  { asin: "B012345678", marketplace: "amazon", price: 20, buyBoxPrice: 20, offerCount: 4, salesRank: 80, category: "Beauty", boughtPastMonth: 100, capturedAt: "2026-10-10T00:00:00.000Z" },
];

// 1. Store round-trip: source offers.
const store = new InMemorySnapshotStore();
await store.saveSourceOffer(offer);
const offers = await store.listSourceOffers();
check("store round-trips source offers", offers.length === 1 && offers[0].title === "Test Widget" && offers[0].price === 8.0, JSON.stringify(offers));

// 2. Store round-trip: snapshots, oldest-first.
for (const s of [...series].reverse()) await store.saveSnapshot(s);
const back = await store.snapshotsForAsin("B012345678");
check("snapshotsForAsin returns oldest-first series", back.length === 4 && back[0].capturedAt < back[3].capturedAt, JSON.stringify(back.map((s) => s.capturedAt)));

// 3. snapshotsForAsinSince filters by timestamp.
const recent = await store.snapshotsForAsinSince("B012345678", "2026-10-08T00:00:00.000Z");
check("snapshotsForAsinSince filters", recent.length === 2 && recent.every((s) => s.capturedAt >= "2026-10-08T00:00:00.000Z"), `${recent.length}`);

// 4. Rank-drop math: 100 -> 90 (drop), 90 -> 120 (no), 120 -> 80 (drop).
check("rankDrops counts improving-rank transitions", rankDrops(series) === 2, `got ${rankDrops(series)}`);

// 5. 90-day average BSR over the full series: (100+90+120+80)/4 = 97.5.
check("averageBsr trailing window", near(averageBsr(series), 97.5, 0.01), `got ${averageBsr(series)}`);

// 6. Price medians: buy box [22,21,23,20] -> 21.5; price same series -> 21.5.
const med = priceMedians(series);
check("priceMedians buy-box median", near(med.buyBoxMedian, 21.5, 0.01), JSON.stringify(med));
check("priceMedians list-price median", near(med.priceMedian, 21.5, 0.01), JSON.stringify(med));

// 7. Velocity from snapshots: bought-past-month floor 100 -> high confidence.
const signals = snapshotsToVelocitySignals(series);
const est = estimateVelocity(signals);
check("velocity-from-snapshots uses bought-past-month floor", est.confidence === "high" && est.monthlySales >= 100, JSON.stringify({ signals, est }));

// 8. Deprecated legacy adapter: Keepa-style fields -> synthetic snapshot.
const legacy = legacyKeepaSignalsToSnapshots("B0LEGACY01", "amazon", { bsr: 5015, boughtPastMonth: 500, category: "Beauty" }, 22);
check(
  "legacy adapter maps fields to snapshot",
  legacy.length === 1 && legacy[0].salesRank === 5015 && legacy[0].boughtPastMonth === 500 && legacy[0].buyBoxPrice === 22,
  JSON.stringify(legacy)
);
const legacyEst = estimateVelocity(snapshotsToVelocitySignals(legacy));
check("legacy adapter path matches old behavior", legacyEst.confidence === "high" && legacyEst.monthlySales >= 500, JSON.stringify(legacyEst));

// 9. ManualOfferAdapter validation: bad offer throws.
let threw = false;
try {
  await new ManualOfferAdapter([{ ...offer, price: -3 }]).scan();
} catch (e) {
  threw = /price must be > 0/.test(String(e && e.message));
}
check("ManualOfferAdapter rejects invalid offers", threw);

// 10. ManualOfferAdapter: valid offers pass through.
const scanned = await new ManualOfferAdapter([offer]).scan();
check("ManualOfferAdapter returns valid offers", scanned.length === 1 && scanned[0].asin === "B012345678");

// 11. FixtureCollector: output shape.
const fixtures = new FixtureCollector({
  B012345678: { marketplace: "amazon", price: 22, buyBoxPrice: 21.5, offerCount: 3, salesRank: 5015, category: "Beauty", boughtPastMonth: 100 },
});
const got = await fixtures.collectSnapshots(["B012345678", "B0MISSING00"]);
check(
  "FixtureCollector output shape",
  got.length === 1 && got[0].asin === "B012345678" && got[0].salesRank === 5015 && typeof got[0].capturedAt === "string",
  JSON.stringify(got)
);

// 12. Stub scanners throw (no live scraping).
let stubThrew = false;
try {
  await new WalmartStubScanner().scan();
} catch (e) {
  stubThrew = /not implemented/i.test(String(e && e.message));
}
check("retailer stubs throw instead of scraping", stubThrew);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
