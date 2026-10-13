-- Alibaba sourcing connection (per-user OAuth tokens).
--
-- The Alibaba Open Platform app ("ArbitrAI Alibaba Sourcing", AppKey in
-- ALIBABA_APP_KEY env) authorizes per buyer account: the founder connects
-- once via /api/alibaba/connect, the OAuth callback stores the tokens
-- here, and the server refreshes them as needed. Columns follow the
-- existing credential-column pattern on this table (walmart_secret,
-- amz_mws_token). App key/secret themselves stay in Vercel env vars —
-- only the per-user OAuth tokens live in the database.

ALTER TABLE nexarb_settings
  ADD COLUMN IF NOT EXISTS alibaba_access_token TEXT;

ALTER TABLE nexarb_settings
  ADD COLUMN IF NOT EXISTS alibaba_refresh_token TEXT;

ALTER TABLE nexarb_settings
  ADD COLUMN IF NOT EXISTS alibaba_token_expires_at TIMESTAMPTZ;

ALTER TABLE nexarb_settings
  ADD COLUMN IF NOT EXISTS alibaba_account TEXT;

ALTER TABLE nexarb_settings
  ADD COLUMN IF NOT EXISTS alibaba_connected_at TIMESTAMPTZ;
