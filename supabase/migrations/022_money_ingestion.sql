-- 022: Money module ingestion (PR-A) — payouts table + sales_events
-- idempotency for the SP-API sync (POST /api/finances/sync).
--
-- /dashboard/pnl already computes per-ASIN FIFO P&L from sales_events
-- (migration 005), but nothing ever wrote to it: there was no Amazon
-- Orders/Finances ingestion anywhere in the app. This migration adds
-- the two storage pieces the sync needs:
--
--  1. public.payouts — one row per Amazon financial event group
--     (a disbursement cycle): amount, currency, status, posted date.
--     bank_tail stays NULL until a settlement-report ingestion exists:
--     Finances v0 group payloads carry no bank-account identifier, and
--     we never invent one.
--  2. sales_events.amazon_order_id + a unique index on
--     (amazon_order_id, asin) so the sync can upsert idempotently —
--     re-running a window replaces the row instead of duplicating the
--     sale (which would double-count revenue and FIFO COGS).
--
-- Idempotent: safe to re-run. Existing sales_events rows keep
-- amazon_order_id NULL; Postgres treats NULLs as distinct in a unique
-- index, so pre-existing manual rows can never collide with it.

create table if not exists public.payouts (
  id text primary key,
  amazon_group_id text not null unique,
  amount numeric not null,
  currency text not null,
  status text not null,
  posted_at timestamptz,
  bank_tail text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_events
  add column if not exists amazon_order_id text;

create unique index if not exists sales_events_amazon_order_asin_key
  on public.sales_events (amazon_order_id, asin);
