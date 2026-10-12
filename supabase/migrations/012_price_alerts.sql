-- Price-drop alert dedup state (per-ASIN, on the watchlist state row).
--
-- The price-drop trigger (lib/engine/priceAlerts.ts) fires at most once per
-- ASIN per 24h per trigger reason. These columns record the last alert so
-- repeated scans don't re-ping the founder for the same drop.
--
-- NOTE: placed on watchlist (the canonical per-ASIN state row) rather than
-- price_monitor, which is append-only per-check telemetry.

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_price_alert_at TIMESTAMPTZ;

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS last_price_alert_reason TEXT;
