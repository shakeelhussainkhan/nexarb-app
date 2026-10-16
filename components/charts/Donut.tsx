"use client";

// Donut chart (pure SVG stroke segments, no dependencies) with a
// legend carrying exact values. A zero total renders a muted empty
// ring — the slices' zeros are shown in the legend, never hidden.

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface Props {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  formatValue?: (n: number) => string;
  size?: number;
  ariaLabel?: string;
}

const R = 54;
const C = 2 * Math.PI * R;
const EMPTY_RING = "#E5E7EB";
const NAVY = "#0D1B2A";

export default function Donut({
  slices,
  centerLabel,
  centerValue,
  formatValue = (n) => n.toLocaleString("en-US"),
  size = 150,
  ariaLabel = "Donut chart",
}: Props) {
  const total = slices.reduce((t, s) => t + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  let acc = 0;
  const segments = slices.map((s) => {
    const frac = total > 0 ? Math.max(0, s.value) / total : 0;
    const seg = { ...s, frac, offset: acc };
    acc += frac;
    return seg;
  });

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg
        viewBox="0 0 140 140"
        width={size}
        height={size}
        className="shrink-0 block"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <circle cx="70" cy="70" r={R} fill="none" stroke={EMPTY_RING} strokeWidth="20" />
        {total > 0 &&
          segments
            .filter((s) => s.frac > 0)
            .map((s) => (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="20"
                strokeDasharray={`${(s.frac * C).toFixed(2)} ${(C - s.frac * C).toFixed(2)}`}
                strokeDashoffset={(-s.offset * C).toFixed(2)}
                transform="rotate(-90 70 70)"
              >
                <title>{`${s.label}: ${formatValue(s.value)} (${(s.frac * 100).toFixed(1)}%)`}</title>
              </circle>
            ))}
        <text x="70" y="66" textAnchor="middle" fontSize="17" fontWeight="600" fill={NAVY}>
          {centerValue}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="10" fill="#9CA3AF">
          {centerLabel}
        </text>
      </svg>
      <div className="flex-1 min-w-40 space-y-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-gray-500 flex-1">{s.label}</span>
            <span className="font-semibold" style={{ color: NAVY }}>
              {formatValue(s.value)}
            </span>
            <span className="text-xs text-gray-400 w-12 text-right">
              {total > 0 ? `${(s.frac * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
        ))}
        {total === 0 && <p className="text-xs text-gray-400">No data in window — all channels are $0.</p>}
      </div>
    </div>
  );
}
