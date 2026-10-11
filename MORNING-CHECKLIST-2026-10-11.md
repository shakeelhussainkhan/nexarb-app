# NexArb — Morning Checklist (2026-10-11)

Everything below is ready. Work through it top to bottom, one step at a time.

## 1. Run migration 006 (Supabase SQL editor, ~1 min)
Paste `supabase/migrations/006_deal_checks_watchlist.sql` from the repo
(main branch) into the Supabase SQL editor and run it. Creates:
- `deal_checks` — every deal-check trace the engine runs
- `watchlist` — ASINs the scanner checks

## 2. Seed the watchlist (~1 min)
In the same SQL editor:
```sql
insert into watchlist (asin, title, buy_price, buy_source, category) values
  ('B004IR3044', 'Scotch-Brite Heavy Duty Scrub Sponges 6ct', 5.97, 'walmart.com', 'Health & Household');
```
(This is the product we live-verified last night: buy $5.97 @ Walmart,
live Amazon price $5.97, brand gated → engine correctly says no-buy.)

## 3. Deploy (your Mac, one command)
```bash
cd /Users/shakeelkhan/nexarb-app && git pull && npx vercel@latest build --prod && npx vercel@latest deploy --prebuilt --prod
```
This pulls PR #21 (dashboard rewiring) and PR #22 (premium site overhaul,
if merged overnight).

## 4. Verify the rewiring (2 min, in the app)
- Dashboard badge should say **"Engine Online"** (not "ArbitrAI Offline").
- Click **"Run scan now"** → it scans the watchlist via the live engine
  (real SP-API price + eligibility + verdict per item) and results appear
  in the deals table.
- The deals table now reads from `deal_checks` — first-party data, no relay.

## 5. Check a deal end-to-end (2 min, browser console on app.nexarb.io)
```js
fetch('/api/deals/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asin:'B004IR3044',buyPrice:5.97,qty:10})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.verdict,null,2)))
```
Expect: live sell price, eligibility, verdict, guard decision — all labeled
with sources.

## What shipped overnight
- **PR #15–#20**: live SP-API pricing (`/products/pricing/v0/competitivePrice`)
  + `POST /api/deals/check` full trace. Root-caused three Amazon 400s
  (param is `Asins` plural; prices live under `payload[0].Product`).
  Live-verified: $5.97 competitive price returned.
- **PR #21**: dashboard rewired off the dead TA relay — "Run scan now"
  works, "Engine Online/Offline" badge, deals/stats/activity from
  first-party tables.
- **PR #22** (pending): cinematic premium site — new landing page with
  AI-generated hero video, polished login/signup/affiliate/blog.

## Still open (not overnight work)
- **Watchlist growth**: send me ASINs + buy prices to add more products.
- **Trial provisioning**: subscription bootstrap still grants unlimited
  Agency — needs the 14-day trial switch before paying users.
- **First real buy**: needs an ungated, profitable product → BUY verdict →
  `POST /api/purchases` → your approval.
- **Listing monitoring / repricing execution**: rules built, not wired to
  live push yet.
