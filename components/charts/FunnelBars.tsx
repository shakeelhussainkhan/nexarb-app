"use client";

// Funnel rows: label + proportional SVG bar + exact value. Bar width
// is proportional to count (relative to the widest row). Rows with a
// zero count still render — in a funnel, an empty stage is real
// information. `tone: "danger"` renders the row in exception red.

export interface FunnelRow {
  label: string;
  count: number;
  amount?: number | null;
  sub?: string;
  tone?: "normal" | "danger";
}

interface Props {
  rows: FunnelRow[];
  formatAmount?: (n: number) => string;
  barColor?: string;
  dangerColor?: string;
  ariaLabel?: string;
}

const NAVY = "#0D1B2A";
const GOLD = "#B8922A";
const RED = "#DC2626";

export default function FunnelBars({
  rows,
  formatAmount = (n) => n.toLocaleString("en-US"),
  barColor = GOLD,
  dangerColor = RED,
  ariaLabel = "Funnel",
}: Props) {
  const max = Math.max(0, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2.5" role="img" aria-label={ariaLabel}>
      {rows.map((r) => {
        const danger = r.tone === "danger";
        const pct = max > 0 ? (r.count / max) * 100 : 0;
        return (
          <div key={r.label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
            <span
              className="text-xs font-medium truncate"
              style={{ color: danger ? RED : NAVY }}
              title={r.label}
            >
              {r.label}
            </span>
            <svg viewBox="0 0 100 14" preserveAspectRatio="none" className="w-full block" style={{ height: 14 }} aria-hidden="true">
              <rect x="0" y="0" width="100" height="14" rx="3" fill="#F3F4F6" />
              {r.count > 0 && (
                <rect
                  x="0"
                  y="0"
                  width={Math.max(1.5, pct)}
                  height="14"
                  rx="3"
                  fill={danger ? dangerColor : barColor}
                  opacity={danger ? 0.85 : 1}
                />
              )}
            </svg>
            <span className="text-right whitespace-nowrap">
              <span className="text-sm font-semibold" style={{ color: danger ? RED : NAVY }}>
                {r.count.toLocaleString("en-US")}
              </span>
              {r.amount !== undefined && r.amount !== null && (
                <span className="text-xs text-gray-400 ml-2">{formatAmount(r.amount)}</span>
              )}
              {r.sub && <span className="block text-[11px] text-gray-400">{r.sub}</span>}
            </span>
          </div>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-gray-400">No data in window</p>}
    </div>
  );
}
