CREATE TABLE IF NOT EXISTS nexarb_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nexarb_subscriptions_user_id_idx ON nexarb_subscriptions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS nexarb_subscriptions_stripe_subscription_id_idx ON nexarb_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
