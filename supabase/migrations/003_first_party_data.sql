-- First-party data platform tables (Phase 0).
-- Mirrors lib/data/types.ts. The Supabase-backed SnapshotStore implementation
-- (not yet written) will read/write these tables.

-- Retailer-sourced offers: what we saw on the shelf, and when.
CREATE TABLE IF NOT EXISTS source_offers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retailer TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stock_state TEXT NOT NULL DEFAULT 'unknown',
  promo TEXT,
  upc TEXT,
  asin TEXT,
  match_confidence NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_offers_retailer ON source_offers (retailer, captured_at);
CREATE INDEX IF NOT EXISTS idx_source_offers_asin ON source_offers (asin) WHERE asin IS NOT NULL;

-- Marketplace price-history snapshots: one row per ASIN per capture.
CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asin TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'amazon',
  price NUMERIC,
  buy_box_price NUMERIC,
  offer_count INTEGER,
  sales_rank INTEGER,
  category TEXT,
  bought_past_month INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_asin ON market_snapshots (asin, marketplace, captured_at);
-- Guard against duplicate captures for the same ASIN/marketplace/instant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_snapshots_asin_captured
  ON market_snapshots (asin, marketplace, captured_at);
