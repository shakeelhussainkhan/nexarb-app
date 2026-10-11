# Deal discovery — retailer adapters

First-party deal discovery: sweep retailer clearance/deals pages, extract
candidate products (+ UPC where available), match UPC → Amazon ASIN via
SP-API Catalog Items, feed the `watchlist` table. The verification engine
(`lib/engine/dealcheck.ts`, `POST /api/scan/trigger`) then scores them.

## Current adapters

| Slug      | Source             | Status |
|-----------|--------------------|--------|
| `walmart` | walmart.com clearance/search | Live (`lib/sourcing/walmart.ts`) |

## Adding the next retailer (Target, Costco, …)

1. **Create `lib/sourcing/<slug>.ts`** implementing `RetailerAdapter`
   (from `./types`). Required shape:

   ```ts
   import type { RetailerAdapter } from "./types";

   export const targetAdapter: RetailerAdapter = {
     slug: "target",
     displayName: "Target",
     async sweep(opts) {
       // plain fetch + HTML/JSON parsing, polite (UA, delays, small concurrency)
       // return { items: SourcedCandidate[], errors: string[] } — NEVER throw
     },
   };
   ```

   Each item: `{ title, price, wasPrice, url, upc, retailer: "<slug>", image? }`.
   `buy_source` in the watchlist becomes `` `<slug>-clearance` `` automatically.

2. **Register it** in `lib/sourcing/adapters.ts`:
   `export const retailerAdapters = [walmartAdapter, targetAdapter];`

3. **Harness it**: add `scripts/verify-sourcing-<slug>.mjs` with fixture
   HTML/JSON (no network), run via the alias loader, all assertions passing.

4. **Wire the sweep route**: `app/api/sourcing/sweep/route.ts` currently
   sweeps Walmart directly. The multi-retailer PR should loop
   `retailerAdapters`, merge items, and pass `retailer` through to
   `buy_source`.

## Hard rules for every adapter

- Plain `fetch` + HTML/JSON parsing only. No browser automation, no paid
  APIs (no Keepa, TA, SellerAmp). Official Amazon SP-API is allowed.
- Polite: real user-agent, 2–3 concurrent requests max, delays between
  requests, hard cap on items per sweep.
- NEVER throw: per-item and per-request try/catch, errors collected into
  the `errors` array (capped).
- Discovery only: adapters write nothing but candidate data. No purchases,
  no intents, no money movement — ever.
