-- NexArb workstream: inventory, P&L, warehouse ops tracker (feat/inventory-pnl-v1).
-- No paid APIs, no secrets. Automated 3PL (interim warehouse) has NO API —
-- warehouse_shipments is an operator-driven tracker for the manual portal workflow.

-- ============================================================================
-- inventory_lots: FIFO purchase lots. A "lot" is one retailer purchase batch.
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_lots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asin TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),            -- units purchased in this lot
  units_remaining INTEGER NOT NULL CHECK (units_remaining >= 0), -- not yet sold
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0), -- landed unit cost (buy + prep + inbound), dollars
  source TEXT,          -- retailer/source, e.g. "Walmart.com", "Target"
  warehouse TEXT,       -- where the units live, e.g. "Automated 3PL vault", "Amazon FBA"
  received_at TIMESTAMPTZ, -- when units became available (drives FIFO + aged-unit math)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_lots_asin_idx ON inventory_lots (asin);
CREATE INDEX IF NOT EXISTS inventory_lots_received_at_idx ON inventory_lots (received_at);

-- ============================================================================
-- sales_events: units sold per ASIN. COGS is derived by running these through
-- FIFO over inventory_lots (oldest received_at first). No secrets here.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asin TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0), -- net sale price per unit, dollars
  fees NUMERIC NOT NULL DEFAULT 0 CHECK (fees >= 0),  -- total marketplace fees for this event, dollars
  sold_at TIMESTAMPTZ,   -- sale date; FIFO consumes lots in sold_at order
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_events_asin_idx ON sales_events (asin);
CREATE INDEX IF NOT EXISTS sales_events_sold_at_idx ON sales_events (sold_at);

-- ============================================================================
-- warehouse_shipments: Automated 3PL ops tracker (manual portal workflow).
--
-- Automated 3PL has NO API. The operator workflow is:
--   1. Create a "vault shipment" in the Automated 3PL portal (retailer order
--      ASINs + quantities).
--   2. Get an email notification when the portal marks the vault received.
--   3. Create the FBA shipment in Amazon Seller Central.
--   4. Tell the portal the FBA shipment ID; the warehouse preps and ships to Amazon.
--   5. Pay the prep invoice by card in the portal.
-- This table mirrors that flow so nothing falls through the cracks.
--
-- Status lifecycle (enforced in app code):
--   created
--     -> in_transit               (retailer shipment on the way to the vault)
--     -> received_at_warehouse    (portal confirms vault receipt)
--     -> prepping                 (warehouse prepping for Amazon)
--     -> shipped_to_amazon        (left the warehouse; FBA shipment ID known)
--     -> delivered_to_amazon      (Amazon confirms receipt)
--   any status -> cancelled       (terminal; never leaves cancelled)
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouse_shipments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retailer_order_ref TEXT,     -- retailer order number(s), e.g. "Walmart #123456"
  tracking_number TEXT,        -- inbound tracking to the warehouse
  carrier TEXT,                -- inbound carrier, e.g. "UPS", "FedEx"
  status TEXT NOT NULL DEFAULT 'created' CHECK (
    status IN ('created','in_transit','received_at_warehouse','prepping','shipped_to_amazon','delivered_to_amazon','cancelled')
  ),
  vault_receipt_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  vault_received_at TIMESTAMPTZ, -- when the portal confirmed vault receipt
  fba_shipment_id TEXT,        -- Amazon Seller Central shipment ID (operator copies from SC)
  outbound_status TEXT,        -- free text on the Amazon-bound leg
  invoice_amount NUMERIC CHECK (invoice_amount >= 0), -- prep invoice $, paid by card in the portal
  invoice_paid BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,                  -- operator log (portal confirmations, names, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS warehouse_shipments_status_idx ON warehouse_shipments (status);
CREATE INDEX IF NOT EXISTS warehouse_shipments_created_at_idx ON warehouse_shipments (created_at);
