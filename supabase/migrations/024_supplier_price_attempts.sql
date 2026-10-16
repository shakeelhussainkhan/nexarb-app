-- Supplier pricing attempts (NexArb Phase 1.5 fix): persist how often
-- the pricing pass (lib/suppliers/offers.ts) has looked up a live Amazon
-- price for a matched offer and come back with no competitive price.
--
-- Why: the pass used to write NOTHING on a no-price lookup and select
-- candidates oldest-first by first_seen_at, so the same no-price offers
-- were re-picked at the head of the queue on every call — the scan
-- livelocked (processed=100 / priced +0 / skipped=100 on every call) and
-- the Frontier catalog drain never advanced past the first block of
-- unpriceable ASINs (priced stuck at ~330 of 8,436 matched).
--
-- With these columns the pass stamps every no-price attempt and the
-- selection policy (lib/suppliers/pricingCore.ts) rotates attempted
-- offers behind fresher ones, enforces a 24h spacing between attempts of
-- the same offer, and removes an offer from the rotation after 3
-- no-price attempts. priced_at keeps its original meaning (set only
-- when a price is actually stored, together with amazon_price) — these
-- columns deliberately do NOT reuse it.
--
-- Existing rows default to 0 attempts / never attempted, i.e. due.

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS price_attempts INT NOT NULL DEFAULT 0;

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS price_attempted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS supplier_offers_price_attempt_idx
  ON supplier_offers (supplier, price_attempted_at);
