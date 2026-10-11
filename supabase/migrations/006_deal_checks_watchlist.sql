-- First-party deal checks + watchlist.
-- Every POST /api/deals/check and every watchlist scan persists its full
-- trace here. The dashboard reads deal_checks (not the dead TA relay).

CREATE TABLE IF NOT EXISTS deal_checks (
  id BIGSERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 10,
  buy_price NUMERIC(12, 2) NOT NULL,
  buy_source TEXT NOT NULL DEFAULT 'founder-supplied',
  sell_price NUMERIC(12, 2),
  sell_price_source TEXT NOT NULL DEFAULT 'unknown',
  eligibility TEXT NOT NULL DEFAULT 'UNKNOWN',
  verdict TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (verdict IN ('BUY', 'SKIP', 'UNKNOWN')),
  verdict_reasons JSONB NOT NULL DEFAULT '[]',
  floor_price NUMERIC(12, 2),
  net_profit NUMERIC(12, 2),
  margin_pct NUMERIC(8, 2),
  would_create_intent BOOLEAN NOT NULL DEFAULT FALSE,
  guard_reasons JSONB NOT NULL DEFAULT '[]',
  checked_by TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_checks_asin_checked_idx ON deal_checks (asin, checked_at DESC);
CREATE INDEX IF NOT EXISTS deal_checks_checked_idx ON deal_checks (checked_at DESC);

-- Watchlist: ASINs the founder wants the engine to re-check on every scan.
CREATE TABLE IF NOT EXISTS watchlist (
  asin TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  buy_price NUMERIC(12, 2) NOT NULL,
  buy_source TEXT NOT NULL DEFAULT 'walmart.com',
  category TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
