-- Supplier listing title (NexArb Phase 1.5 fix): persist the Amazon
-- listing title for the ASIN a supplier offer matched to, so pack
-- normalization (lib/suppliers/packNormalizeCore.ts) has an auditable
-- record of what the stored Amazon price actually buys.
--
-- Why: the pipeline paired single-unit supplier costs with Amazon
-- CASE-PACK prices and reported wildly inflated nets — hand-vetting
-- the top 5 Frontier candidates on 2026-10-16 found every one was a
-- pack mismatch (e.g. Wicked Joe coffee: $12.20/bag cost vs a $105.07
-- listing that is a pack of 6 → true unit price $17.51, true net
-- ≈ −$1.82, not +$67.81). The listing's own pack declaration is the
-- authority on what its price buys; the evaluator now divides the
-- stored price by the declared pack quantity before any economics
-- run, and records the normalization in eval_reasons.
--
-- The evaluation pass (lib/suppliers/evaluate.ts) writes this column:
-- the live Catalog title fetched during evaluation wins, and the
-- stored value is the fallback when a later live fetch fails. Rows
-- that have never been (re-)evaluated keep NULL — NULL means "title
-- not yet captured", never "single unit".
--
-- APPLY THIS MIGRATION BEFORE DEPLOYING THE CODE THAT READS/WRITES
-- listing_title: lib/suppliers/evaluate.ts and
-- app/api/suppliers/route.ts select the column, and PostgREST errors
-- on a missing column.

ALTER TABLE supplier_offers
  ADD COLUMN IF NOT EXISTS listing_title TEXT;
