-- Supplier offers: distributor catalog ingestion (NexArb Phase 1).
--
-- Petra has no API — its portal product-list download (prodlist.csv) is
-- parsed by lib/suppliers/petraCore.ts and upserted here by
-- POST /api/sourcing/petra. Each row is one supplier SKU at its current
-- wholesale cost and on-hand quantity. A bounded matching pass
-- (POST /api/sourcing/petra/match) resolves UPCs to Amazon ASINs via the
-- same SP-API Catalog Items matcher discovery uses; a pricing pass
-- (POST /api/sourcing/petra/scan) stores the live Amazon price and an
-- ESTIMATED net/margin (fee stack in lib/engine/pricing.ts + a $1.50/unit
-- 3PL prep rate — estimates, never exact fees).
--
-- This phase is ingest/match/price only: nothing here orders, creates
-- purchase intents, or spends money.
--
-- RLS: service-role only, consistent with the other NexArb tables.

CREATE TABLE IF NOT EXISTS supplier_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT NOT NULL,
  supplier_sku TEXT NOT NULL,
  vendor_sku TEXT,
  title TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  cost_price NUMERIC(12, 2) NOT NULL,
  map_price NUMERIC(12, 2),
  msrp NUMERIC(12, 2),
  qty_available INT NOT NULL DEFAULT 0,
  image_url TEXT,
  product_class TEXT,
  subcategory TEXT,
  weight_lb NUMERIC(10, 4),
  origin_country TEXT,
  matched_asin TEXT,
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'matched', 'no_match', 'error')),
  amazon_price NUMERIC(12, 2),
  est_net NUMERIC(12, 2),
  est_margin_pct NUMERIC(6, 1),
  priced_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier, supplier_sku)
);

CREATE INDEX IF NOT EXISTS supplier_offers_match_status_idx
  ON supplier_offers (supplier, match_status);
CREATE INDEX IF NOT EXISTS supplier_offers_margin_idx
  ON supplier_offers (est_margin_pct DESC NULLS LAST);

ALTER TABLE supplier_offers ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.

CREATE TABLE IF NOT EXISTS supplier_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT NOT NULL,
  source_file_date DATE,
  rows_received INT NOT NULL DEFAULT 0,
  inserted INT NOT NULL DEFAULT 0,
  updated INT NOT NULL DEFAULT 0,
  matched INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_import_runs ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.
