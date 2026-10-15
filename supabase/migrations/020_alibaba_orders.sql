-- 020: Alibaba order flow (2026-10-14).
-- alibaba_orders: one row per order drafted from a sourced Alibaba offer.
-- Lifecycle: draft -> pending_approval -> approved -> ready_to_place ->
-- placed -> shipped -> delivered, with failed/cancelled recorded.
-- An order can only be placed when its linked purchase intent (purchases,
-- migration 004) is APPROVED — the purchases pipeline stays the single
-- gate for spending. On placement (or ready_to_place, while the Alibaba
-- order APIs are unverified) the platform auto-creates the compliance
-- records: a product_compliance row (with its checklist) and an
-- import_shipments row, linked both ways.

create table if not exists alibaba_orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  ref text not null unique,
  alibaba_order_id text,
  alibaba_product_id text not null,
  sku_id text,
  title text not null,
  image_url text,
  detail_url text,
  supplier_name text,
  target_asin text,
  expected_sell_price numeric(12, 2),
  qty integer not null check (qty > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  shipping_per_unit numeric(12, 2) not null default 0,
  landed_per_unit numeric(12, 2) not null check (landed_per_unit > 0),
  order_total numeric(14, 2) not null check (order_total > 0),
  currency text not null default 'USD',
  moq integer,
  offer_snapshot jsonb not null default '{}'::jsonb,
  screening_verdict text not null default 'clear'
    check (screening_verdict in ('clear', 'review', 'blocked')),
  screening_reasons jsonb not null default '[]'::jsonb,
  screening_category text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'ready_to_place',
                      'placed', 'shipped', 'delivered', 'failed', 'cancelled')),
  purchase_intent_id text references purchases (id) on delete set null,
  shipment_id uuid,
  product_compliance_id uuid,
  alibaba_status_raw jsonb,
  placed_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists alibaba_orders_user_idx on alibaba_orders (user_id, created_at desc);
create index if not exists alibaba_orders_status_idx on alibaba_orders (user_id, status);
create index if not exists alibaba_orders_intent_idx on alibaba_orders (purchase_intent_id);

-- Link the compliance records both ways (added after both tables exist to
-- avoid a circular foreign key at create time; guarded so a re-run is safe).
do $$
begin
  alter table alibaba_orders
    add constraint alibaba_orders_shipment_fk
    foreign key (shipment_id) references import_shipments (id) on delete set null;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table alibaba_orders
    add constraint alibaba_orders_product_compliance_fk
    foreign key (product_compliance_id) references product_compliance (id) on delete set null;
exception when duplicate_object then null;
end $$;
alter table import_shipments
  add column if not exists alibaba_order_id uuid references alibaba_orders (id) on delete set null;
create index if not exists import_shipments_alibaba_order_idx on import_shipments (alibaba_order_id);
