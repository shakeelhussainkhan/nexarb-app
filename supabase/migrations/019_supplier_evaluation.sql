-- Supplier-offer evaluation (NexArb Phase 1.5): the verdict layer that
-- turns matched + priced supplier_offers from a spreadsheet of margin
-- estimates into a vetted, season-weighted order shortlist.
--
-- POST /api/sourcing/evaluate (lib/suppliers/evaluate.ts +
-- evaluateCore.ts) weighs freight-aware economics, BSR-model velocity,
-- SP-API eligibility, supplier stock, and a bounded Q4 seasonal boost,
-- and stores the outcome here. Verdicts: 'candidate' (clears every bar —
-- promotable to the watchlist), 'watch' (profitable but one signal is
-- weak/unknown), 'pass' (unprofitable after freight, or not listable).
-- eval_reasons is the human-readable audit trail for the verdict.
--
-- promoted_watchlist_asin records promotion to the watchlist
-- (POST /api/suppliers/promote, session-only). It stores the ASIN because
-- the watchlist's primary key IS the ASIN (migration 006: asin TEXT
-- PRIMARY KEY) — there is no UUID on a watchlist row to reference, so the
-- linkage column is TEXT keyed by that PK.

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS eval_verdict TEXT
    CHECK (eval_verdict IN ('candidate', 'watch', 'pass'));

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS eval_score NUMERIC(6, 1);

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS eval_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS promoted_watchlist_asin TEXT;

CREATE INDEX IF NOT EXISTS supplier_offers_eval_verdict_idx
  ON supplier_offers (eval_verdict);
