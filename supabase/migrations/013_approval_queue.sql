-- Approval queue: profitable-but-gated products worth an Amazon brand
-- approval application.
--
-- Populated by the watchlist scan (lib/engine/scan.ts) whenever a deal
-- check comes back APPROVAL_REQUIRED with economics that clear the bar
-- (best-channel net > 0 and margin >= 25% — lib/engine/approvalQueueCore.ts).
-- approval_url is the application link Amazon's Listings Restrictions API
-- returns for that ASIN; there is no API to submit the application, so the
-- founder applies from the dashboard and marks the row applied/dismissed.
-- Scans only ever insert new rows or refresh economics on "pending" rows —
-- the founder's applied/dismissed decisions are never overwritten.
--
-- RLS: service-role only, consistent with the other NexArb tables.

CREATE TABLE IF NOT EXISTS approval_queue (
  asin TEXT PRIMARY KEY,
  title TEXT,
  approval_url TEXT NOT NULL,
  channel TEXT NOT NULL,
  net_per_unit NUMERIC(12, 2) NOT NULL,
  margin_pct NUMERIC(6, 1) NOT NULL,
  buy_price NUMERIC(12, 2),
  sell_price NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS approval_queue_status_idx ON approval_queue (status);

ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;
-- Service-role only: no public policies are created here.
