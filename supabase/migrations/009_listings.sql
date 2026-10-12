-- Selling cockpit: live Amazon/Walmart listings + manual reprice audit trail.
--
-- listings: one row per seller SKU per channel, synced from the live
-- marketplaces by POST /api/listings/sync. Prices here mirror reality —
-- our_price is the live list price read from the channel, buybox_price /
-- buybox_winner / offer_count come from the channel's competitive data.
-- Manual price changes go through POST /api/listings/[id]/reprice, which
-- writes the channel AND logs to reprice_audit. Nothing else mutates
-- our_price; there is no auto-repricing.
--
-- RLS: service-role only, consistent with the other NexArb tables.

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('amazon', 'walmart')),
  seller_sku TEXT NOT NULL,
  asin TEXT, -- NULL for Walmart SKUs with no known ASIN mapping
  title TEXT,
  our_price NUMERIC(12, 2),
  buybox_price NUMERIC(12, 2),
  buybox_winner BOOLEAN,
  offer_count INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel, seller_sku)
);

CREATE INDEX IF NOT EXISTS listings_channel_asin_idx ON listings (channel, asin);
CREATE INDEX IF NOT EXISTS listings_last_synced_idx ON listings (last_synced_at);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.

CREATE TABLE IF NOT EXISTS reprice_audit (
  id BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  seller_sku TEXT NOT NULL,
  asin TEXT NOT NULL,
  old_price NUMERIC(12, 2),
  new_price NUMERIC(12, 2) NOT NULL,
  actor TEXT NOT NULL,
  channel_result TEXT NOT NULL CHECK (channel_result IN ('applied', 'failed')),
  channel_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reprice_audit_listing_created_idx
  ON reprice_audit (listing_id, created_at);

ALTER TABLE reprice_audit ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.
