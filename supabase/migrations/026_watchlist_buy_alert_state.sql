-- BUY-signal alert dedup state (per-ASIN, on the watchlist state row).
--
-- Telegram BUY alerts (lib/telegram/alerts.ts) used to fire on every scan
-- for every BUY verdict, so an unchanged signal re-alerted several times a
-- day (identical alerts at 08:58 and 20:58 on 2026-10-16, and again the
-- next morning). These columns record the signal snapshot at the moment
-- the last BUY alert was actually delivered; the pure predicate in
-- lib/telegram/buyAlertCore.ts compares the current trace against this
-- snapshot and only re-alerts on a new BUY, a re-entry after a non-BUY
-- check, an eligibility change, or a material sell-price move (>= 5% AND
-- >= $0.50 vs the last alerted price).
--
-- NOTE: placed on watchlist (the canonical per-ASIN state row) rather than
-- a new telegram_alert_state table — same reasoning as migration 012,
-- which put the price-drop dedup state here too. A separate table would
-- duplicate the per-ASIN keying watchlist already owns and drift from the
-- row scans already maintain. If the migration has not been applied yet,
-- the alert path degrades to "never alerted" and alerts fire as before.

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_buy_alert_at TIMESTAMPTZ;

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_buy_alert_verdict TEXT;

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_buy_alert_sell_price NUMERIC(12, 2);

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_buy_alert_eligibility TEXT;
