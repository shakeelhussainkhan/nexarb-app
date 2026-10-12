-- Assisted checkout queue (founder-approved).
--
-- purchases gains:
--   retailer_url    — the retailer product page to buy from (walmart.com,
--                     target.com, costco.com). Copied from watchlist.source_url
--                     when the intent originates from a watchlist row, or
--                     supplied directly in POST /api/purchases.
--   checkout_status — lifecycle of the browser-assisted checkout. The browser
--                     prepares the cart and STOPS at the payment step; it never
--                     enters card details and never completes payment.
--
-- watchlist gains:
--   source_url — the retailer product URL captured at discovery time, so the
--                intent can carry it forward to checkout.
--
-- RLS: service-role only, consistent with the other first-party tables
-- (no public policies are created here).

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS retailer_url TEXT;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS checkout_status TEXT NOT NULL DEFAULT 'none'
  CHECK (checkout_status IN ('none', 'requested', 'in_progress', 'awaiting_payment', 'completed', 'failed'));

ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS source_url TEXT;

-- purchases RLS (service-role only; mirrors existing tables).
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
