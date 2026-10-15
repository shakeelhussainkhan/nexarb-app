-- 023: Order lifecycle (PR-D1) — external_orders.
--
-- Orders placed OUTSIDE the app (a distributor portal like Petra's, an
-- email order to a fulfillment desk, a phone order) previously had NO
-- record in NexArb at all: alibaba_orders covers app-placed Alibaba
-- orders and purchases covers in-app intents, so a real order the
-- founder placed in a supplier's own portal was invisible to every
-- dashboard. This table is that record.
--
-- milestones is the journey evidence: an append-only jsonb array of
-- {stage, at, source, detail} entries in the canonical lifecycle
-- vocabulary defined in lib/lifecycle/core.ts (draft, pending_approval,
-- approved, placed, paid, shipped, at_warehouse, prepped, to_amazon,
-- listed, selling, returned, cancelled, failed, problem). Later
-- automation (the Petra email watch) appends milestones as confirmations,
-- invoices and tracking emails arrive; the unified journeys API
-- (GET /api/orders/journeys) renders them alongside the other sources.
--
-- status is a free text mirror of the furthest canonical stage (no
-- CHECK constraint: the vocabulary lives in lib/lifecycle/core.ts and
-- external systems report states we should store verbatim rather than
-- reject). user_id follows the scoping pattern of every other
-- user-owned table (alibaba_orders, import_shipments).
--
-- Nothing is seeded: rows are created by the account holder via
-- POST /api/orders/external (session-only) or by later automation.
-- Idempotent: safe to re-run.

create table if not exists public.external_orders (
  id text primary key,
  user_id text not null,
  ref text not null,
  supplier text not null,
  title text not null,
  asin text,
  qty integer,
  amount numeric(14, 2),
  currency text not null default 'USD',
  status text not null default 'placed',
  milestones jsonb not null default '[]'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists external_orders_user_idx
  on public.external_orders (user_id, created_at desc);
