-- Feature 1: Telegram per-user connection tracking
ALTER TABLE nexarb_settings ADD COLUMN IF NOT EXISTS telegram_connected BOOLEAN DEFAULT FALSE;
ALTER TABLE nexarb_settings ADD COLUMN IF NOT EXISTS telegram_connected_at TIMESTAMPTZ;
ALTER TABLE nexarb_settings ADD COLUMN IF NOT EXISTS amz_marketplace TEXT;

-- Feature 7: Affiliates table
CREATE TABLE IF NOT EXISTS nexarb_affiliates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  promotion_method TEXT,
  status TEXT DEFAULT 'pending',
  referral_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
