// Marketplace-side data collection for the first-party data platform.
//
// MarketDataCollector is the contract for collecting MarketSnapshots (price,
// Buy Box, offer counts, sales rank, bought-in-past-month) per ASIN. Phase 0
// ships FixtureCollector — canned snapshots for tests and offline
// development. It never touches the network.
//
// LIVE IMPLEMENTATION NOTE (do not build without credentials):
// The production collector will use the official Amazon Selling Partner API —
// the Catalog Items API (v2022-04-01) for ASIN metadata and the Product
// Pricing API (v0) getPricing / getItemOffers for Buy Box price, offer
// counts, and sales rank — plus Walmart's official marketplace APIs.
// Building that requires real seller credentials first: an SP-API developer
// application, OAuth authorization from the selling account (refresh token,
// client id/secret, seller id, marketplace id), and Walmart API keys.
// There is no screen scraping and no paid third-party data vendor anywhere in
// this path.

import type { MarketSnapshot } from "./types.ts";

export interface MarketDataCollector {
  collectSnapshots(asins: string[]): Promise<MarketSnapshot[]>;
}

// Canned snapshots keyed by ASIN. Unknown ASINs yield no snapshots (an honest
// empty, never a fabricated series).
export class FixtureCollector implements MarketDataCollector {
  private readonly fixtures: Record<string, Omit<MarketSnapshot, "asin" | "capturedAt"> & { capturedAt?: string }>;

  constructor(fixtures: Record<string, Omit<MarketSnapshot, "asin" | "capturedAt"> & { capturedAt?: string }>) {
    this.fixtures = fixtures;
  }

  async collectSnapshots(asins: string[]): Promise<MarketSnapshot[]> {
    const now = new Date().toISOString();
    return asins.flatMap((asin) => {
      const fixture = this.fixtures[asin];
      if (!fixture) return [];
      const { capturedAt, ...rest } = fixture;
      return [{ ...rest, asin, capturedAt: capturedAt ?? now }];
    });
  }
}
