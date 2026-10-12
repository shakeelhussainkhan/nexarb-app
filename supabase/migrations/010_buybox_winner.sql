-- Buy Box rotation history: record who held the Buy Box lane on each check.
--
-- deal_checks.buybox_winner is written by persistDealCheck from the SP-API
-- competitive-price belongsToRequester flag: 'us' when the live offer
-- belonged to our own seller account, 'competitor' when a competitor's,
-- 'unknown' when the flag was absent or the chosen channel wasn't Amazon.
-- Checks before this migration read back as NULL -> surfaced as "unknown".

ALTER TABLE deal_checks
  ADD COLUMN IF NOT EXISTS buybox_winner TEXT
  CHECK (buybox_winner IN ('us', 'competitor', 'unknown'));

CREATE INDEX IF NOT EXISTS deal_checks_asin_buybox_idx ON deal_checks (asin, checked_at DESC)
  WHERE buybox_winner IS NOT NULL;
