-- Guarded purchasing: purchase intents + audit trail.
-- An intent is created by POST /api/purchases (gated: BUY verdict, live
-- eligibility, spend caps, kill switch) and sits in PENDING_APPROVAL until a
-- human approves or rejects it via POST /api/purchases/[id]/approve.

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  asin TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price > 0),
  verdict TEXT NOT NULL CHECK (verdict IN ('BUY', 'SKIP', 'UNKNOWN')),
  eligibility TEXT NOT NULL CHECK (eligibility IN ('SELLABLE', 'APPROVAL_REQUIRED', 'BLOCKED', 'UNKNOWN')),
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_reason TEXT
);

CREATE INDEX IF NOT EXISTS purchases_asin_created_idx ON purchases (asin, created_at);
CREATE INDEX IF NOT EXISTS purchases_status_created_idx ON purchases (status, created_at);

CREATE TABLE IF NOT EXISTS purchase_audit (
  id BIGSERIAL PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_audit_purchase_idx ON purchase_audit (purchase_id, created_at);
