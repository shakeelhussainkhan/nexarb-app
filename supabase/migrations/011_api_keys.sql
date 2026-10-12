-- Personal API keys for first-party integrations (e.g. the NexArb Chrome
-- extension). Keys are stored as SHA-256 hashes only — the plaintext key is
-- shown once at creation time and never again. Revocation is a soft delete
-- via revoked_at so past usage stays auditable.

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'extension',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_created_idx ON api_keys (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
