-- WS3: first-party velocity tracking (basic Keepa replacement).
--
-- velocity_snapshots: periodic SP-API catalog rank reads per ASIN. A series
-- of these feeds snapshotsToVelocitySignals() in lib/engine/velocity.ts —
-- rank drops across the series approximate sale events (a floor on units).
-- price_monitor: per-channel price samples for the watchlist repricer.
-- watchlist gains a price band + an autoreprice opt-in flag (other workers
-- drive the repricing loop; defaults keep existing rows unchanged).

CREATE TABLE IF NOT EXISTS velocity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  sales_rank INTEGER,
  category TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS velocity_snapshots_asin_checked_idx
  ON velocity_snapshots (asin, checked_at DESC);

ALTER TABLE velocity_snapshots ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.

CREATE TABLE IF NOT EXISTS price_monitor (
  id BIGSERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  channel TEXT NOT NULL,
  our_price NUMERIC(12, 2),
  buy_box_price NUMERIC(12, 2),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS price_monitor_asin_checked_idx
  ON price_monitor (asin, checked_at DESC);

ALTER TABLE price_monitor ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.

ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS price_min NUMERIC(12, 2);
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS price_max NUMERIC(12, 2);
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS autoreprice_enabled BOOLEAN NOT NULL DEFAULT FALSE;
