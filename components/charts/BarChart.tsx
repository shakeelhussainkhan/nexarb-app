"use client";

import { useMemo } from "react";

// Grouped bar chart (pure SVG, no dependencies), dashboard light
// theme. One or more series aligned to shared labels. An empty labels
// array renders an honest "no data" box; zero values render as
// zero-height bars on a real axis.

export interface BarChartSeries {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  labels: string[];
  series: BarChartSeries[];
  formatValue?: (n: number) => string;
  height?: number;
  emptyMessage?: string;
  ariaLabel?: string;
}

const W = 640;
const PAD = { l: 54, r: 10, t: 10, b: 24 };
const GRID = "#EDF0F3";
const AXIS = "#9CA3AF";
const NAVY = "#0D1B2A";

export default function BarChart({
  labels,
  series,
  formatValue = (n) => n.toLocaleString("en-US"),
  height = 200,
  emptyMessage = "No data in window",
  ariaLabel = "Bar chart",
}: Props) {
  const geo = useMemo(() => {
    if (labels.length === 0 || series.length === 0) return null;
    const iw = W - PAD.l - PAD.r;
    const ih = height - PAD.t - PAD.b;
    let max = 0;
    for (const s of series) for (const v of s.values) if (Number.isFinite(v) && v > max) max = v;
    const yMax = max > 0 ? max : 1;
    const y = (v: number) => PAD.t + (1 - v / yMax) * ih;
    const ticks = [0, 1, 2, 3].map((i) => (yMax * i) / 3);
    const groupW = iw / labels.length;
    const barW = Math.max(1, (groupW * 0.72) / series.length);
    const labelStep = Math.max(1, Math.ceil(labels.length / 8));
    return { iw, ih, yMax, y, ticks, groupW, barW, labelStep };
  }, [labels, series, height]);

  if (!geo) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      {series.length > 1 && (
        <div className="flex items-center gap-4 flex-wrap mb-1">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="font-semibold" style={{ color: NAVY }}>
                {formatValue(s.values.reduce((t, v) => t + (Number.isFinite(v) ? v : 0), 0))}
              </span>
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full block" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {geo.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke={GRID} strokeWidth="1" />
            <text x={PAD.l - 6} y={geo.y(t) + 3} textAnchor="end" fontSize="10" fill={AXIS}>
              {formatValue(t)}
            </text>
          </g>
        ))}
        {labels.map((lab, i) => {
          const gx = PAD.l + i * geo.groupW;
          const totalBarW = geo.barW * series.length;
          const startX = gx + (geo.groupW - totalBarW) / 2;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = Math.max(0, s.values[i] ?? 0);
                const bh = geo.ih - (geo.y(v) - PAD.t);
                return (
                  <rect
                    key={s.label}
                    x={startX + si * geo.barW}
                    y={geo.y(v)}
                    width={Math.max(0.5, geo.barW - 0.5)}
                    height={bh}
                    fill={s.color}
                    rx="1"
                  >
                    <title>{`${lab} · ${s.label}: ${formatValue(v)}`}</title>
                  </rect>
                );
              })}
              {i % geo.labelStep === 0 && (
                <text x={gx + geo.groupW / 2} y={height - 6} textAnchor="middle" fontSize="10" fill={AXIS}>
                  {lab}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
