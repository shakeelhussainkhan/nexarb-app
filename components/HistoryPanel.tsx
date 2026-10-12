"use client";

import { useEffect, useState } from "react";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import BuyBoxHistory from "@/components/BuyBoxHistory";
import type { PricePoint, PriceHistorySummary } from "@/lib/engine/priceHistory";
import type { BuyBoxObservation } from "@/lib/engine/buyboxHistory";

type BuyBoxRow = { checkedAt: string; sellPrice: number | null; winner: "us" | "competitor" | "unknown" };

// Lazy-fetched price history for one ASIN. Mounts only when the deal row's
// "Price history" toggle is expanded, so the deals table stays fast.
// Also fetches Buy Box observations (?include=buybox) and renders the
// rotation strip under the price chart.
export default function HistoryPanel({ asin, buyPrice }: { asin: string; buyPrice: number }) {
  const [data, setData] = useState<{ points: PricePoint[]; summary: PriceHistorySummary; buybox: BuyBoxObservation[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/history?asin=${encodeURIComponent(asin)}&days=90&include=buybox`);
        if (!res.ok) throw new Error("failed");
        const json = (await res.json()) as { points: PricePoint[]; summary: PriceHistorySummary; buybox?: BuyBoxRow[] };
        if (!cancelled) {
          setData({
            points: json.points,
            summary: json.summary,
            buybox: (json.buybox ?? []).map((b) => ({ checkedAt: b.checkedAt, sellPrice: b.sellPrice, winner: b.winner })),
          });
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asin]);

  if (error) {
    return <div className="text-sm px-1 py-3" style={{ color: "#F87171" }}>Couldn't load price history — try again later.</div>;
  }
  if (!data) {
    return <div className="text-sm px-1 py-3" style={{ color: "#9CA3AF" }}>Loading price history…</div>;
  }
  return (
    <div>
      <PriceHistoryChart points={data.points} summary={data.summary} buyPrice={buyPrice} />
      <BuyBoxHistory observations={data.buybox} />
    </div>
  );
}
