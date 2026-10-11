// First-party data platform types (Phase 0).
//
// NexArb owns its sourcing and market data. Standing rule: NO paid
// third-party data subscriptions (no Keepa, Tactical Arbitrage, SellerAmp,
// Aura, repricer APIs). These types are the single shape for retailer-sourced
// offers and marketplace price history. Supabase DDL mirrors them in
// supabase/migrations/003_first_party_data.sql.

export type StockState = "in-stock" | "limited" | "out-of-stock" | "unknown";

export interface SourceOffer {
  retailer: string; // e.g. "walmart", "target", "bestbuy", "manual"
  url: string; // product page URL (source of truth for the offer)
  title: string; // retailer product title, verbatim
  price: number; // current shelf price, in `currency`
  currency: string; // ISO 4217, e.g. "USD"
  stockState: StockState;
  promo: string | null; // e.g. "Buy 2 get 1 free"; null when none
  upc: string | null; // retailer UPC when known; null when unknown
  asin?: string; // matched ASIN once the offer is matched to a listing
  capturedAt: string; // ISO-8601 timestamp of capture
  matchConfidence: number; // 0..1 confidence that retailer product = asin
}

export interface MarketSnapshot {
  asin: string;
  marketplace: string; // e.g. "amazon" (US), "walmart"
  price: number | null; // lowest listed price when known
  buyBoxPrice: number | null;
  offerCount: number | null; // comparable offers on the listing
  salesRank: number | null; // category best-sellers rank (BSR)
  category: string | null; // category the salesRank is measured against
  boughtPastMonth?: number; // Amazon "bought in past month" lower bound
  capturedAt: string; // ISO-8601 timestamp of capture
}
