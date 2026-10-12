"use client";

import { useMemo } from "react";
import type { PricePoint, PriceHistorySummary, DealQuality } from "@/lib/engine/priceHistory";

interface Props {
  points: PricePoint[];
  summary: PriceHistorySummary;
  /** Optional buy-price reference line (the deal's current buy $). */
  buyPrice?: number;
}

const W = 640;
const H = 240;
const PAD = { l: 56, r: 14, t: 18, b: 30 };

const NAVY = "#0A0F1E";
const GOLD = "#D4AF37";
const GOLD_DIM = "#B8922A";

const QUALITY_STYLES: Record<DealQuality, { bg: string; text: string; label: string }> = {
  "genuine dip": { bg: "#F0FDF4", text: "#16A34A", label: "Genuine dip — price is below its normal band" },
  typical: { bg: "#F9FAFB", text: "#6B7280", label: "Typical — price is in its normal band" },
  elevated: { bg: "#FFFBEB", text: "#B45309", label: "Elevated — above normal band, wait for a dip" },
  "insufficient data": { bg: "#F9FAFB", text: "#9CA3AF", label: "Not enough history yet — check back after more scans" },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function PriceHistoryChart({ points, summary, buyPrice }: Props) {
  const geo = useMemo(() => {
    const priced = points.filter((p) => Number.isFinite(p.sellPrice) && p.sellPrice > 0);
    if (priced.length === 0) return null;
    const times = priced.map((p) => new Date(p.checkedAt).getTime());
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const tSpan = Math.max(tMax - tMin, 1);
    const sells = priced.map((p) => p.sellPrice);
    let pMin = Math.min(...sells);
    let pMax = Math.max(...sells);
    if (buyPrice && Number.isFinite(buyPrice) && buyPrice > 0) {
      pMin = Math.min(pMin, buyPrice);
      pMax = Math.max(pMax, buyPrice);
    }
    // Median band edges also need to fit.
    if (summary.medianSell) {
      pMin = Math.min(pMin, summary.medianSell * 0.9);
      pMax = Math.max(pMax, summary.medianSell * 1.1);
    }
    const pad = (pMax - pMin) * 0.12 || 1;
    const yMin = Math.max(0, pMin - pad);
    const yMax = pMax + pad;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (t: number) => PAD.l + ((t - tMin) / tSpan) * iw;
    const y = (p: number) => PAD.t + (1 - (p - yMin) / Math.max(yMax - yMin, 1e-9)) * ih;
    const line = priced.map((p, i) => `${i === 0 ? "M" : "L"}${x(new Date(p.checkedAt).getTime()).toFixed(1)},${y(p.sellPrice).toFixed(1)}`).join(" ");
    const ticks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3);
    return { priced, tMin, tMax, x, y, line, ticks, yMin, yMax };
  }, [points, summary.medianSell, buyPrice]);

  const q = QUALITY_STYLES[summary.dealQuality];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: NAVY }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD_DIM }}>
          Sell-price history
        </span>
        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: q.bg, color: q.text }}>
          {q.label}
        </span>
      </div>

      {!geo ? (
        <div className="px-4 pb-4 pt-8 text-center text-sm" style={{ color: "#9CA3AF" }}>
          No price history yet — each scan records the live sell price, so this fills in over time.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label="Sell price history chart">
          {/* gridlines */}
          {geo.ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={PAD.l - 8} y={geo.y(t) + 4} textAnchor="end" fontSize={10} fill="#9CA3AF">
                {fmtPrice(t)}
              </text>
            </g>
          ))}
          {/* median "typical" band */}
          {summary.medianSell && (
            <rect
              x={PAD.l}
              width={W - PAD.l - PAD.r}
              y={geo.y(summary.medianSell * 1.1)}
              height={Math.max(geo.y(summary.medianSell * 0.9) - geo.y(summary.medianSell * 1.1), 2)}
              fill="rgba(212,175,55,0.10)"
            />
          )}
          {/* median line */}
          {summary.medianSell && (
            <line
              x1={PAD.l} x2={W - PAD.r}
              y1={geo.y(summary.medianSell)} y2={geo.y(summary.medianSell)}
              stroke={GOLD_DIM} strokeWidth={1} strokeDasharray="6 4" opacity={0.8}
            />
          )}
          {/* buy-price reference */}
          {buyPrice && Number.isFinite(buyPrice) && buyPrice > 0 && (
            <g>
              <line
                x1={PAD.l} x2={W - PAD.r}
                y1={geo.y(buyPrice)} y2={geo.y(buyPrice)}
                stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3 4" opacity={0.7}
              />
              <text x={W - PAD.r - 4} y={geo.y(buyPrice) - 5} textAnchor="end" fontSize={10} fill="#9CA3AF">
                buy {fmtPrice(buyPrice)}
              </text>
            </g>
          )}
          {/* price line */}
          <path d={geo.line} fill="none" stroke={GOLD} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {/* current price marker */}
          {geo.priced.length > 0 && (
            <g>
              <circle
                cx={geo.x(new Date(geo.priced[geo.priced.length - 1].checkedAt).getTime())}
                cy={geo.y(geo.priced[geo.priced.length - 1].sellPrice)}
                r={5} fill={GOLD} stroke={NAVY} strokeWidth={2}
              />
              <text
                x={Math.min(geo.x(new Date(geo.priced[geo.priced.length - 1].checkedAt).getTime()) + 10, W - PAD.r - 64)}
                y={geo.y(geo.priced[geo.priced.length - 1].sellPrice) - 8}
                fontSize={11} fontWeight={700} fill={GOLD}
              >
                {fmtPrice(geo.priced[geo.priced.length - 1].sellPrice)}
              </text>
            </g>
          )}
          {/* x labels */}
          <text x={PAD.l} y={H - 8} fontSize={10} fill="#9CA3AF">{fmtDate(new Date(geo.tMin).toISOString())}</text>
          <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize={10} fill="#9CA3AF">{fmtDate(new Date(geo.tMax).toISOString())}</text>
        </svg>
      )}

      {/* summary stats */}
      {summary.count > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 pb-3 pt-1 text-xs" style={{ color: "#9CA3AF" }}>
          <span><b style={{ color: "#fff" }}>{summary.count}</b> scans</span>
          {summary.minSell !== null && <span>min <b style={{ color: "#fff" }}>{fmtPrice(summary.minSell)}</b></span>}
          {summary.maxSell !== null && <span>max <b style={{ color: "#fff" }}>{fmtPrice(summary.maxSell)}</b></span>}
          {summary.avgSell !== null && <span>avg <b style={{ color: "#fff" }}>{fmtPrice(summary.avgSell)}</b></span>}
          {summary.medianSell !== null && <span>median <b style={{ color: GOLD }}>{fmtPrice(summary.medianSell)}</b></span>}
          {summary.deltaVsMedianPct !== null && (
            <span>
              vs median{" "}
              <b style={{ color: summary.deltaVsMedianPct <= -10 ? "#16A34A" : summary.deltaVsMedianPct >= 10 ? "#B45309" : "#fff" }}>
                {summary.deltaVsMedianPct >= 0 ? "+" : ""}{summary.deltaVsMedianPct.toFixed(1)}%
              </b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
