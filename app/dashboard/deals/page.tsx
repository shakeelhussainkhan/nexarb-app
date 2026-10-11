"use client";

import { useState, useMemo, useEffect, useCallback } from "react";

type Deal = {
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
  engine: {
    verdict: "BUY" | "SKIP" | "UNKNOWN";
    reasons: string[];
    floorPrice: number;
    realisticPrice: number;
    netProfitAtRealistic: number;
    marginAtRealistic: number;
    estMonthlySales: number;
    velocityBasis: string;
    velocityConfidence: string;
    daysToClear: number | null;
    suggestedQty: number;
  };
};

const CHANNEL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Amazon: { bg: "#FFF3E0", text: "#E65100", dot: "#FF6D00" },
  Walmart: { bg: "#E3F2FD", text: "#0277BD", dot: "#0288D1" },
  Alibaba: { bg: "#FCE4EC", text: "#C62828", dot: "#E53935" },
};

type SortKey = "title" | "buyPrice" | "sellPrice" | "floor" | "net" | "bsr" | "clear";

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("All");
  const [verdictFilter, setVerdictFilter] = useState("All");
  const [sortBy, setSortBy] = useState<SortKey>("net");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minProfit, setMinProfit] = useState("");
  const [maxBsr, setMaxBsr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/deals");
      if (!res.ok) throw new Error("failed");
      const data: Deal[] = await res.json();
      setDeals(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  const sortValue = (d: Deal, key: SortKey): number | string => {
    switch (key) {
      case "title": return d.title.toLowerCase();
      case "floor": return d.engine.floorPrice;
      case "net": return d.engine.netProfitAtRealistic;
      case "clear": return d.engine.daysToClear ?? Number.POSITIVE_INFINITY;
      default: return d[key] as number;
    }
  };

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (search && !d.title.toLowerCase().includes(search.toLowerCase()) && !d.asin.toLowerCase().includes(search.toLowerCase())) return false;
      if (channelFilter !== "All" && d.channel !== channelFilter) return false;
      if (verdictFilter !== "All" && d.engine.verdict !== verdictFilter) return false;
      if (minProfit && d.engine.netProfitAtRealistic < Number(minProfit)) return false;
      if (maxBsr && d.bsr > Number(maxBsr)) return false;
      return true;
    }).sort((a, b) => {
      const av = sortValue(a, sortBy);
      const bv = sortValue(b, sortBy);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [deals, search, channelFilter, verdictFilter, minProfit, maxBsr, sortBy, sortDir]);

  function toggleSort(col: SortKey) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  }

  async function actOn(asin: string, action: "buy" | "skip") {
    try {
      const res = await fetch("/api/deals/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, action }),
      });
      if (!res.ok) throw new Error("failed");
      setDeals((prev) => prev.filter((d) => d.asin !== asin));
      setSelected((prev) => { const s = new Set(prev); s.delete(asin); return s; });
    } catch {
      setNotice(`Could not record ${action} for ${asin} — the deal server didn't confirm. Nothing was removed.`);
    }
  }

  async function bulkAct(action: "buy" | "skip") {
    for (const asin of [...selected]) await actOn(asin, action);
  }

  function exportCsv() {
    const rows = [["ASIN", "Product", "Category", "Buy $", "Sell $", "Floor $", "Net @ Sell $", "Margin %", "BSR", "Est Sales/mo", "Days to Clear", "Suggested Qty", "Verdict", "Channel", "Reasons"]];
    filtered.forEach((d) => rows.push([
      d.asin, d.title, d.category, String(d.buyPrice), String(d.sellPrice), String(d.engine.floorPrice),
      String(d.engine.netProfitAtRealistic), String(d.engine.marginAtRealistic), String(d.bsr),
      String(d.engine.estMonthlySales), d.engine.daysToClear === null ? "" : String(d.engine.daysToClear),
      String(d.engine.suggestedQty), d.engine.verdict, d.channel, d.engine.reasons.join(" "),
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "nexarb-deals.csv";
    a.click();
  }

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.asin));

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => { const s = new Set(prev); filtered.forEach((d) => s.delete(d.asin)); return s; });
    } else {
      setSelected((prev) => new Set([...prev, ...filtered.map((d) => d.asin)]));
    }
  }

  const channels = useMemo(() => ["All", ...Array.from(new Set(deals.map((d) => d.channel)))], [deals]);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
            All Deals
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? "Loading live deals…" : `${filtered.length} of ${deals.length} live deals · verdicts from the velocity + floor-price engine (fee inputs are estimates until per-ASIN fee data is wired)`}
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition hover:bg-gray-50"
          style={{ color: "#0D1B2A", borderColor: "#E5E7EB" }}
        >
          ↓ Export CSV
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
      )}
      {loadError && !loading && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The deal server didn't respond, so no deals are shown — we never substitute sample data here.
          <button onClick={() => { setLoading(true); fetchDeals(); }} className="ml-3 font-semibold underline">Retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products or ASIN…"
            className="flex-1 min-w-48 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
          />
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A]"
          >
            {channels.map((c) => <option key={c} value={c}>{c === "All" ? "All Channels" : c}</option>)}
          </select>
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A]"
          >
            <option value="All">All Verdicts</option>
            <option value="BUY">BUY</option>
            <option value="SKIP">SKIP</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
          <input
            type="number"
            value={minProfit}
            onChange={(e) => setMinProfit(e.target.value)}
            placeholder="Min net $"
            className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300"
          />
          <input
            type="number"
            value={maxBsr}
            onChange={(e) => setMaxBsr(e.target.value)}
            placeholder="Max BSR"
            className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300"
          />
          {(search || channelFilter !== "All" || verdictFilter !== "All" || minProfit || maxBsr) && (
            <button
              onClick={() => { setSearch(""); setChannelFilter("All"); setVerdictFilter("All"); setMinProfit(""); setMaxBsr(""); }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition"
            >
              Clear
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mt-3 flex items-center gap-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button onClick={() => bulkAct("buy")} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white" style={{ background: "#0D1B2A" }}>
              Bulk Approve
            </button>
            <button onClick={() => bulkAct("skip")} className="px-3 py-1.5 text-xs font-semibold rounded-lg border text-gray-500 border-gray-200">
              Bulk Skip
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3.5">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded accent-[#0D1B2A]" />
                </th>
                {([
                  ["title", "Product"], ["buyPrice", "Buy $"], ["sellPrice", "Sell $"], ["floor", "Floor $"],
                  ["net", "Net @ Sell"], ["bsr", "BSR"], ["clear", "Clear"],
                ] as [SortKey, string][]).map(([col, label]) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
                    style={{ color: sortBy === col ? "#B8922A" : "#9CA3AF" }}
                  >
                    {label} {sortBy === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                  </th>
                ))}
                <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>Verdict</th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>Channel</th>
                <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal, i) => (
                <tr
                  key={deal.asin + deal.id}
                  className="border-b border-gray-50 transition-colors hover:bg-gray-50/60"
                  style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}
                >
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={selected.has(deal.asin)}
                      onChange={() => setSelected((prev) => { const s = new Set(prev); s.has(deal.asin) ? s.delete(deal.asin) : s.add(deal.asin); return s; })}
                      className="rounded accent-[#0D1B2A]"
                    />
                  </td>
                  <td className="px-4 py-3.5 font-medium max-w-52 whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: "#0D1B2A" }} title={deal.title}>
                    {deal.title}
                    <span className="block text-[11px] font-normal text-gray-400">{deal.asin} · {deal.category}</span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.buyPrice.toFixed(2)}</td>
                  <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.sellPrice.toFixed(2)}</td>
                  <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.engine.floorPrice.toFixed(2)}</td>
                  <td className="px-4 py-3.5 font-semibold whitespace-nowrap" style={{ color: deal.engine.netProfitAtRealistic >= 0 ? "#16A34A" : "#DC2626" }}>
                    {deal.engine.netProfitAtRealistic >= 0 ? "+" : "−"}${Math.abs(deal.engine.netProfitAtRealistic).toFixed(2)}
                    <span className="block text-[11px] font-normal text-gray-400">{deal.engine.marginAtRealistic.toFixed(1)}% margin</span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">{deal.bsr ? deal.bsr.toLocaleString() : "—"}</td>
                  <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">
                    {deal.engine.daysToClear === null ? "—" : `~${deal.engine.daysToClear}d`}
                    <span className="block text-[11px] text-gray-400">{deal.engine.estMonthlySales}/mo est.</span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <VerdictBadge verdict={deal.engine.verdict} />
                    <span className="block max-w-56 whitespace-normal text-[11px] leading-snug text-gray-400 mt-1">{deal.engine.reasons[0]}</span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <ChannelBadge channel={deal.channel} />
                    <span className="block text-[11px] text-gray-400 mt-1">{deal.verifiedPrice ? "✓ Verified price" : "~ Estimated price"}</span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => actOn(deal.asin, "buy")} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white" style={{ background: "#B8922A" }}>Buy</button>
                      <button onClick={() => actOn(deal.asin, "skip")} className="px-2.5 py-1 rounded-lg text-xs font-semibold border text-gray-400 border-gray-200 hover:bg-gray-50">Skip</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">{deals.length === 0 ? "No live deals right now." : "No deals match your filters."}</p>
            {deals.length > 0 && (
              <button
                onClick={() => { setSearch(""); setChannelFilter("All"); setVerdictFilter("All"); setMinProfit(""); setMaxBsr(""); }}
                className="mt-3 text-sm font-medium"
                style={{ color: "#B8922A" }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {loading && (
          <div className="py-16 text-center"><p className="text-gray-400 text-sm">Loading live deals…</p></div>
        )}
      </div>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const c = CHANNEL_COLORS[channel] ?? { bg: "#F5F5F5", text: "#616161", dot: "#9E9E9E" };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap" style={{ background: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
      {channel}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: "BUY" | "SKIP" | "UNKNOWN" }) {
  const styles = {
    BUY: { background: "#F0FDF4", color: "#16A34A" },
    SKIP: { background: "#FEF2F2", color: "#DC2626" },
    UNKNOWN: { background: "#F9FAFB", color: "#6B7280" },
  } as const;
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap" style={styles[verdict]}>
      {verdict === "BUY" ? "✓ BUY" : verdict === "SKIP" ? "✕ SKIP" : "? UNKNOWN"}
    </span>
  );
}
