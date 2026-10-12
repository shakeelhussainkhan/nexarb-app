"use client";

import { useMemo } from "react";
import {
  buyboxWinRate,
  currentStreak,
  type BuyBoxObservation,
} from "@/lib/engine/buyboxHistory";

// Compact Buy Box rotation strip: one dot per check, colored by who held the
// Buy Box lane. Gold = we held it, gray = competitor, hollow = unknown
// (check predates the winner recording or the flag was absent).
const GOLD = "#D4AF37";
const GRAY = "#9CA3AF";

export default function BuyBoxHistory({ observations }: { observations: BuyBoxObservation[] }) {
  const { stats, streak, shown } = useMemo(() => {
    const s = buyboxWinRate(observations);
    const st = currentStreak(observations);
    // Cap the strip at the 60 most recent observations so it stays readable.
    const sorted = [...observations].sort((a, b) => (a.checkedAt < b.checkedAt ? -1 : 1));
    return { stats: s, streak: st, shown: sorted.slice(-60) };
  }, [observations]);

  if (shown.length === 0) {
    return (
      <div className="text-xs px-1 py-2" style={{ color: "#9CA3AF" }}>
        No Buy Box observations yet — they accumulate as scans run.
      </div>
    );
  }

  const winPct = stats.winRate === null ? null : Math.round(stats.winRate * 100);
  const streakLabel =
    streak.winner === null
      ? "no current streak"
      : streak.winner === "us"
        ? `we hold it ×${streak.count}`
        : `competitor holds it ×${streak.count}`;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
        <span className="text-xs font-semibold" style={{ color: "#E5E7EB" }}>
          Buy Box rotation
        </span>
        <span className="text-xs" style={{ color: "#9CA3AF" }}>
          {winPct === null ? "no known winner yet" : `we held it ${winPct}% of checks`}
        </span>
        <span className="text-xs" style={{ color: "#9CA3AF" }}>
          streak: {streakLabel}
        </span>
        <span className="flex items-center gap-3 text-xs ml-auto" style={{ color: "#9CA3AF" }}>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GOLD }} /> us
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GRAY }} /> competitor
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border"
              style={{ borderColor: "#4B5563", background: "transparent" }}
            />{" "}
            unknown
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Buy Box winner per check">
        {shown.map((o, i) => {
          const d = new Date(o.checkedAt);
          const date = Number.isNaN(d.getTime()) ? o.checkedAt : d.toLocaleString();
          const title =
            o.winner === "us"
              ? `We held the Buy Box — ${date}${o.sellPrice != null ? ` — $${o.sellPrice.toFixed(2)}` : ""}`
              : o.winner === "competitor"
                ? `Competitor held the Buy Box — ${date}${o.sellPrice != null ? ` — $${o.sellPrice.toFixed(2)}` : ""}`
                : `Winner unknown — ${date}`;
          const style =
            o.winner === "us"
              ? { background: GOLD }
              : o.winner === "competitor"
                ? { background: GRAY }
                : { background: "transparent", border: "1.5px solid #4B5563" };
          return (
            <span
              key={`${o.checkedAt}-${i}`}
              role="listitem"
              title={title}
              className="inline-block w-3 h-3 rounded-full"
              style={style}
            />
          );
        })}
      </div>
    </div>
  );
}
