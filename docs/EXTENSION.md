# NexArb Chrome Extension — "Deal Check" v1

SellerAmp-style one-click deal analysis while browsing Amazon — powered by
your own first-party NexArb engine. No paid data subscriptions, no Keepa,
nothing sent to third parties.

## What it does

- Detects Amazon product pages from the tab URL and extracts the ASIN.
- On open, runs a **scout analysis**: live Buy Box price (SP-API), your
  brand eligibility, estimated monthly sales (first-party BSR model), and
  the **max buy price** that still clears a 20% margin at the live sell price.
- Enter your buy price → runs the **full deal-check engine** (the same one
  the dashboard uses): BUY / SKIP / UNKNOWN verdict, net profit, margin,
  floor price, suggested quantity.
- The extension **never** reads your Amazon session cookies, never touches
  forms or checkout, and never sends anything to Amazon. Its only network
  call is to your NexArb API with your personal API key.

## What it doesn't do

- No price-history charts in the popup yet (they live on the deals page).
- It never creates purchase intents — analysis only. Buying stays in the
  dashboard's guarded flow.
- Scout mode doesn't persist deal-check rows (no buy price = no check row);
  it does record the sales-rank snapshot, which feeds the velocity model.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or Brave/Edge).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extensions/nexarb/` folder in
   this repo.
4. Pin the NexArb icon to the toolbar if you like.

No build step — it's vanilla HTML/CSS/JS (Manifest V3).

## Create an API key

Option A — API (after the settings route is deployed):

```bash
curl -s -X POST https://app.nexarb.io/api/settings/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: <your Clerk session cookie>" \
  -d '{"action":"create","name":"chrome-extension"}'
```

(The endpoint is Clerk-gated; easiest is to add a small UI for it later or
call it from the browser console while signed in. The response contains
`plaintext` — copy it now, it's never shown again.)

Option B — SQL fallback (service role only, Supabase SQL editor):

```sql
-- generate the key locally first, then store its SHA-256:
--   node -e "const c=require('crypto');const k='nxr_'+c.randomBytes(32).toString('base64url');console.log(k);console.log(c.createHash('sha256').update(k).digest('hex'))"
INSERT INTO api_keys (user_id, key_hash, name)
VALUES ('<your-clerk-user-id>', '<sha256-hex>', 'chrome-extension');
```

Then open the extension popup → **Settings** → paste the key → Save.
The key is verified before it's stored, and lives only in
`chrome.storage.local` on your device.

Revoke anytime: `POST /api/settings/api-keys {"action":"revoke","id":"<uuid>"}`.

## Test it

1. Load the extension unpacked (above).
2. Save your API key in the popup's Settings view.
3. Open any Amazon product page (e.g. `https://www.amazon.com/dp/B004IR3044`).
4. Click the NexArb icon. You should see the Buy Box price, eligibility,
   est. sales/mo, and a max buy price within a few seconds.
5. Enter a buy price and hit **Analyze** → full verdict with profit/margin.

## API

`POST /api/extension/check` — header `X-NexArb-Key: nxr_…`

```json
{ "asin": "B004IR3044" }              // scout mode
{ "asin": "B004IR3044", "buyPrice": 5.97 }  // full mode
```

Rate limit: 60 requests/minute per key (429 + `Retry-After` when exceeded).

## Files

- `extensions/nexarb/` — the extension (manifest, content script, popup, icons)
- `lib/extension/keys.ts` — key generation / SHA-256 hashing / verification
- `lib/extension/rateLimit.ts` — in-memory 60/min limiter
- `lib/extension/analysis.ts` — ASIN extraction, max-buy-price math
- `app/api/extension/check/route.ts` — the analysis endpoint
- `app/api/settings/api-keys/route.ts` — key create/revoke (Clerk-gated)
- `supabase/migrations/011_api_keys.sql` — the `api_keys` table
- `scripts/verify-extension.mjs` — offline harness (34 checks)
