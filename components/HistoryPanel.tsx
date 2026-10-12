"use client";

import { useEffect, useState } from "react";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import type { PricePoint, PriceHistorySummary } from "@/lib/engine/priceHistory";

// Lazy-fetched price history for one ASIN. Mounts only when the deal row's
// "Price history" toggle is expanded, so the deals table stays fast.
export default function HistoryPanel({ asin, buyPrice }: { asin: string; buyPrice: number }) {
  const [data, setData] = useState<{ points: PricePoint[]; summary: PriceHistorySummary } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/history?asin=${encodeURIComponent(asin)}&days=90`);
        if (!res.ok) throw new Error("failed");
        const json = (await res.json()) as { points: PricePoint[]; summary: PriceHistorySummary };
        if (!cancelled) setData({ points: json.points, summary: json.summary });
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
  return <PriceHistoryChart points={data.points} summary={data.summary} buyPrice={buyPrice} />;
}
