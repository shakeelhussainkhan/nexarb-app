-- NexArb users table
CREATE TABLE IF NOT EXISTS nexarb_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  plan TEXT DEFAULT 'trial',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NexArb settings table (one row per user)
CREATE TABLE IF NOT EXISTS nexarb_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  amz_seller_id TEXT,
  amz_mws_token TEXT,
  walmart_client_id TEXT,
  walmart_secret TEXT,
  telegram_token TEXT,
  telegram_chat_id TEXT,
  email_alerts BOOLEAN DEFAULT TRUE,
  high_confidence_only BOOLEAN DEFAULT FALSE,
  min_profit NUMERIC DEFAULT 20,
  min_roi NUMERIC DEFAULT 30,
  max_bsr INTEGER DEFAULT 50000,
  excluded_categories TEXT[] DEFAULT ARRAY['Adult', 'Weapons'],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- NexArb waitlist table (if not already exists)
CREATE TABLE IF NOT EXISTS nexarb_waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NexArb subscriptions table (populated by Stripe webhook)
CREATE TABLE IF NOT EXISTS nexarb_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'inactive',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
