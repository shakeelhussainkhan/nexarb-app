"use client";

import { useMemo } from "react";

// Tiny inline trend line (pure SVG). Empty input renders a muted
// "no data" box; a constant series renders a flat midline — both are
// truthful renderings, never a broken chart.

interface Props {
  values: number[];
  color?: string;
  height?: number;
  emptyMessage?: string;
  ariaLabel?: string;
}

const W = 240;
const PAD = 3;
const DEFAULT_COLOR = "#B8922A";

export default function Sparkline({
  values,
  color = DEFAULT_COLOR,
  height = 40,
  emptyMessage = "No data in window",
  ariaLabel = "Sparkline",
}: Props) {
  const geo = useMemo(() => {
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    const x = (i: number) => PAD + (values.length === 1 ? (W - 2 * PAD) / 2 : (i / (values.length - 1)) * (W - 2 * PAD));
    const y = (v: number) =>
      span === 0 ? height / 2 : PAD + (1 - (v - min) / span) * (height - 2 * PAD);
    const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `${line} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
    return { line, area, lastX: x(values.length - 1), lastY: y(values[values.length - 1]) };
  }, [values, height]);

  if (!geo) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 text-xs text-gray-400"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full block"
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      <path d={geo.area} fill={color} opacity="0.12" />
      <path d={geo.line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={geo.lastX} cy={geo.lastY} r="3" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
