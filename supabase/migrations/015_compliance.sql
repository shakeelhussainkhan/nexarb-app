-- 015: import-compliance layer (2026-10-13 research implementation).
-- product_compliance: one row per product being sourced/imported, with
-- its screening verdict, category, HTS and per-item checklist statuses.
-- import_shipments: one row per inbound shipment with ISF/entry state.
-- compliance_documents: certificates, test reports, entry documents —
-- the importer's 5-year archive index (19 CFR Part 163).
-- nexarb_settings gains the importer profile (bond / broker / IOR).

create table if not exists product_compliance (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  asin text,
  alibaba_product_id text,
  title text not null,
  supplier_name text,
  category text not null default 'general',
  hts_code text,
  origin_country text not null default 'CN',
  screening_verdict text not null default 'clear',
  screening_reasons jsonb not null default '[]'::jsonb,
  checklist_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_compliance_user_idx on product_compliance (user_id);
create index if not exists product_compliance_asin_idx on product_compliance (user_id, asin);
create index if not exists product_compliance_ali_idx on product_compliance (user_id, alibaba_product_id);

create table if not exists import_shipments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  supplier_name text,
  origin_country text not null default 'CN',
  origin_port text,
  dest_port text,
  transport text not null default 'ocean',
  etd date,
  eta date,
  status text not null default 'planning',
  entry_number text,
  broker_name text,
  customs_value numeric not null default 0,
  duty_estimate jsonb,
  isf_data jsonb not null default '{}'::jsonb,
  isf_filed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists import_shipments_user_idx on import_shipments (user_id);

create table if not exists compliance_documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  product_compliance_id uuid references product_compliance (id) on delete set null,
  shipment_id uuid references import_shipments (id) on delete set null,
  doc_type text not null default 'other',
  title text not null,
  file_url text,
  issuer text,
  issued_at date,
  expires_at date,
  status text not null default 'needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compliance_documents_user_idx on compliance_documents (user_id);

alter table nexarb_settings add column if not exists ior_legal_name text;
alter table nexarb_settings add column if not exists customs_bond_amount numeric;
alter table nexarb_settings add column if not exists customs_bond_provider text;
alter table nexarb_settings add column if not exists customs_broker_name text;
alter table nexarb_settings add column if not exists trailing_duties_taxes_fees numeric;
