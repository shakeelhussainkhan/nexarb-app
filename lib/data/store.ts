// Snapshot store abstraction for the first-party data platform.
//
// The store holds retailer source offers and marketplace price-history
// snapshots. Phase 0 ships an in-memory implementation for tests and offline
// development; a Supabase-backed implementation (Postgres tables in
// supabase/migrations/003_first_party_data.sql) replaces it once credentials
// and RLS policies are wired — the interface does not change.

import type { MarketSnapshot, SourceOffer } from "./types.ts";

export interface SnapshotStore {
  saveSourceOffer(offer: SourceOffer): Promise<void>;
  listSourceOffers(): Promise<SourceOffer[]>;
  saveSnapshot(snapshot: MarketSnapshot): Promise<void>;
  snapshotsForAsin(asin: string, marketplace?: string): Promise<MarketSnapshot[]>;
  snapshotsForAsinSince(asin: string, sinceIso: string, marketplace?: string): Promise<MarketSnapshot[]>;
}

export class InMemorySnapshotStore implements SnapshotStore {
  private offers: SourceOffer[] = [];
  private snapshots: MarketSnapshot[] = [];

  async saveSourceOffer(offer: SourceOffer): Promise<void> {
    this.offers.push({ ...offer });
  }

  async listSourceOffers(): Promise<SourceOffer[]> {
    return this.offers.map((o) => ({ ...o }));
  }

  async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    this.snapshots.push({ ...snapshot });
  }

  async snapshotsForAsin(asin: string, marketplace?: string): Promise<MarketSnapshot[]> {
    return this.snapshots
      .filter((s) => s.asin === asin && (marketplace === undefined || s.marketplace === marketplace))
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .map((s) => ({ ...s }));
  }

  async snapshotsForAsinSince(
    asin: string,
    sinceIso: string,
    marketplace?: string
  ): Promise<MarketSnapshot[]> {
    const all = await this.snapshotsForAsin(asin, marketplace);
    return all.filter((s) => s.capturedAt >= sinceIso);
  }
}
