import { NextResponse } from "next/server";
import { evaluateDeal, type DealVerdict, type DealForVerdict } from "@/lib/engine/verdict";
import {
  legacyKeepaSignalsToSnapshots,
  priceMedians,
  snapshotsToVelocitySignals,
} from "@/lib/engine/velocity";
import type { MarketSnapshot } from "@/lib/data/types";

const BACKEND_URL = "http://137.184.184.27:3001";

export interface Deal {
  id: number;
  asin: string;
  title: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  margin: number;
  bsr: number;
  channel: string;
  confidence: string;
  verifiedPrice: boolean;
  category: string;
  timestamp: string;
}

export interface EnrichedDeal extends Deal {
  engine: DealVerdict;
}

// Phase 0: no live snapshot store is wired into this route yet — this returns
// [] for every ASIN, so legacy relay deals flow through the deprecated
// Keepa-field adapter below. Once the MarketDataCollector + SnapshotStore are
// live (SP-API credentials required), return that deal's snapshot series here
// and the snapshot-aware path takes over automatically.
async function snapshotsForDeal(asin: string): Promise<MarketSnapshot[]> {
  void asin;
  return [];
}

function buildDealForVerdict(d: Deal, snapshots: MarketSnapshot[]): DealForVerdict {
  if (snapshots.length > 0) {
    // Snapshot-aware path (preferred): NexArb price history beats spot.
    const { buyBoxMedian } = priceMedians(snapshots);
    return {
      buyPrice: d.buyPrice,
      sellPrice: d.sellPrice,
      realisticPrice: buyBoxMedian ?? d.sellPrice,
      bsr: d.bsr,
      category: d.category,
      velocitySignals: snapshotsToVelocitySignals(snapshots),
    };
  }
  // Legacy relay path: map the relay deal's Keepa-style fields into a
  // synthetic snapshot series, then derive signals from it. Behavior matches
  // the old bsr/category evaluation.
  const legacySnapshots = legacyKeepaSignalsToSnapshots(
    d.asin,
    "amazon",
    { bsr: d.bsr, category: d.category },
    d.sellPrice
  );
  return {
    buyPrice: d.buyPrice,
    sellPrice: d.sellPrice,
    bsr: d.bsr,
    category: d.category,
    velocitySignals: snapshotsToVelocitySignals(legacySnapshots),
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(`${BACKEND_URL}/deals`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data: Deal[] = await res.json();
    const enriched: EnrichedDeal[] = [];
    for (const d of data) {
      const snapshots = await snapshotsForDeal(d.asin);
      enriched.push({ ...d, engine: evaluateDeal(buildDealForVerdict(d, snapshots)) });
    }
    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
