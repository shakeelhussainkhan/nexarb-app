-- Product display info (Amazon catalog title / brand / image) on the
-- watchlist, so the deals UI can show what a product actually is instead
-- of a bare ASIN.
--
-- Sourced from SP-API Catalog Items responses already flowing through
-- sourcing ingest (lib/sourcing/match.ts) and persisted at match time;
-- rows ingested before this migration backfill lazily — the scan and
-- GET /api/deals fetch the catalog record once for any row whose
-- product_title is still NULL (lib/engine/productBackfill.ts).
--
-- Deliberately separate from watchlist.title: that column holds the
-- title captured at discovery and feeds alert text; product_title is
-- the canonical Amazon catalog item name for display.

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS product_title TEXT;

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS product_brand TEXT;

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS product_image_url TEXT;
