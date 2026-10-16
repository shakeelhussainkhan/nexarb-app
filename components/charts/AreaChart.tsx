"use client";

import { useMemo } from "react";

// Multi-series area/line chart (pure SVG, no dependencies) in the
// dashboard's light theme. Data comes from the metrics API only; an
// empty labels array renders an honest "no data" box, never a broken
// chart. An all-zero series renders as a flat baseline — that IS the
// data (the API zero-fills its daily series).

export interface AreaChartSeries {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  /** X-axis labels, aligned index-for-index with every series' values. */
  labels: string[];
  series: AreaChartSeries[];
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

export default function AreaChart({
  labels,
  series,
  formatValue = (n) => n.toLocaleString("en-US"),
  height = 220,
  emptyMessage = "No data in window",
  ariaLabel = "Area chart",
}: Props) {
  const geo = useMemo(() => {
    if (labels.length === 0) return null;
    const iw = W - PAD.l - PAD.r;
    const ih = height - PAD.t - PAD.b;
    let max = 0;
    for (const s of series) for (const v of s.values) if (Number.isFinite(v) && v > max) max = v;
    const yMax = max > 0 ? max : 1;
    const x = (i: number) => PAD.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = (v: number) => PAD.t + (1 - v / yMax) * ih;
    const ticks = [0, 1, 2, 3].map((i) => (yMax * i) / 3);
    const labelStep = Math.max(1, Math.ceil(labels.length / 6));
    const paths = series.map((s) => {
      const line = s.values
        .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Math.max(0, v)).toFixed(1)}`)
        .join(" ");
      const area = `${line} L${x(s.values.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
      return { line, area };
    });
    return { iw, ih, yMax, x, y, ticks, labelStep, paths };
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
        {series.map((s, si) => (
          <g key={s.label}>
            <path d={geo.paths[si].area} fill={s.color} opacity="0.10" />
            <path d={geo.paths[si].line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
          </g>
        ))}
        {labels.map((lab, i) =>
          i % geo.labelStep === 0 ? (
            <text key={i} x={geo.x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill={AXIS}>
              {lab}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
