"use client";

import { useState, useMemo } from "react";

type Channel = "Amazon" | "Walmart" | "Alibaba";

type Deal = {
  id: number;
  product: string;
  category: string;
  buyPrice: number;
  sellPrice: number;
  bsr: number;
  channel: Channel;
  aiScore: number;
  priceType: "Verified" | "Estimated";
  margin: number;
  profit: number;
};

const DEALS: Deal[] = [
  { id: 1, product: "Sony WH-1000XM5 Headphones", category: "Electronics", buyPrice: 229.99, sellPrice: 348.00, bsr: 523, channel: "Amazon", aiScore: 94, priceType: "Verified", profit: 118.01, margin: 51.3 },
  { id: 2, product: "Instant Pot Duo 7-in-1 6Qt", category: "Kitchen", buyPrice: 49.95, sellPrice: 89.99, bsr: 1240, channel: "Walmart", aiScore: 88, priceType: "Verified", profit: 40.04, margin: 80.2 },
  { id: 3, product: "Apple AirPods Pro (2nd Gen)", category: "Electronics", buyPrice: 189.00, sellPrice: 249.99, bsr: 340, channel: "Amazon", aiScore: 91, priceType: "Verified", profit: 60.99, margin: 32.3 },
  { id: 4, product: "Dyson V15 Detect Vacuum", category: "Home", buyPrice: 449.00, sellPrice: 649.99, bsr: 2100, channel: "Amazon", aiScore: 82, priceType: "Estimated", profit: 200.99, margin: 44.8 },
  { id: 5, product: "LEGO Technic McLaren F1", category: "Toys", buyPrice: 89.00, sellPrice: 159.99, bsr: 5400, channel: "Alibaba", aiScore: 77, priceType: "Estimated", profit: 70.99, margin: 79.8 },
  { id: 6, product: "Ninja Foodi 10-in-1 Pressure Cooker", category: "Kitchen", buyPrice: 99.00, sellPrice: 169.95, bsr: 3200, channel: "Walmart", aiScore: 85, priceType: "Verified", profit: 70.95, margin: 71.7 },
  { id: 7, product: "Samsung 65\" QLED 4K TV", category: "Electronics", buyPrice: 799.00, sellPrice: 1199.99, bsr: 8700, channel: "Amazon", aiScore: 79, priceType: "Estimated", profit: 400.99, margin: 50.2 },
  { id: 8, product: "Anker 737 Power Bank 24000mAh", category: "Electronics", buyPrice: 69.99, sellPrice: 109.99, bsr: 920, channel: "Alibaba", aiScore: 93, priceType: "Verified", profit: 40.00, margin: 57.2 },
  { id: 9, product: "KitchenAid Artisan Stand Mixer", category: "Kitchen", buyPrice: 279.00, sellPrice: 449.99, bsr: 4300, channel: "Walmart", aiScore: 86, priceType: "Verified", profit: 170.99, margin: 61.3 },
  { id: 10, product: "GoPro HERO12 Black Camera", category: "Electronics", buyPrice: 299.00, sellPrice: 399.99, bsr: 1850, channel: "Amazon", aiScore: 72, priceType: "Estimated", profit: 100.99, margin: 33.8 },
  { id: 11, product: "Vitamix 5200 Blender", category: "Kitchen", buyPrice: 349.00, sellPrice: 549.95, bsr: 9200, channel: "Alibaba", aiScore: 80, priceType: "Verified", profit: 200.95, margin: 57.6 },
  { id: 12, product: "Weber Spirit II E-310 Grill", category: "Outdoor", buyPrice: 449.00, sellPrice: 649.00, bsr: 12400, channel: "Walmart", aiScore: 75, priceType: "Estimated", profit: 200.00, margin: 44.5 },
];

const CHANNEL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Amazon: { bg: "#FFF3E0", text: "#E65100", dot: "#FF6D00" },
  Walmart: { bg: "#E3F2FD", text: "#0277BD", dot: "#0288D1" },
  Alibaba: { bg: "#FCE4EC", text: "#C62828", dot: "#E53935" },
};

export default function DealsPage() {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<"All" | Channel>("All");
  const [sortBy, setSortBy] = useState<keyof Deal>("aiScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minProfit, setMinProfit] = useState("");
  const [maxBsr, setMaxBsr] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    return DEALS.filter((d) => {
      if (search && !d.product.toLowerCase().includes(search.toLowerCase())) return false;
      if (channelFilter !== "All" && d.channel !== channelFilter) return false;
      if (minProfit && d.profit < Number(minProfit)) return false;
      if (maxBsr && d.bsr > Number(maxBsr)) return false;
      return true;
    }).sort((a, b) => {
      const av = a[sortBy] as number | string;
      const bv = b[sortBy] as number | string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [search, channelFilter, sortBy, sortDir, minProfit, maxBsr]);

  function toggleSort(col: keyof Deal) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  }

  function exportCsv() {
    const rows = [["Product", "Category", "Buy $", "Sell $", "Profit", "Margin %", "BSR", "Channel", "AI Score", "Price Type"]];
    filtered.forEach((d) => rows.push([d.product, d.category, String(d.buyPrice), String(d.sellPrice), String(d.profit.toFixed(2)), String(d.margin.toFixed(1)), String(d.bsr), d.channel, String(d.aiScore), d.priceType]));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "nexarb-deals.csv";
    a.click();
  }

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => { const s = new Set(prev); filtered.forEach((d) => s.delete(d.id)); return s; });
    } else {
      setSelected((prev) => new Set([...prev, ...filtered.map((d) => d.id)]));
    }
  }

  const SortIcon = ({ col }: { col: keyof Deal }) => (
    <span className="ml-1 opacity-40" style={{ color: sortBy === col ? "#B8922A" : undefined, opacity: sortBy === col ? 1 : 0.3 }}>
      {sortBy === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
            All Deals
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{filtered.length} of {DEALS.length} deals</p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition hover:bg-gray-50"
          style={{ color: "#0D1B2A", borderColor: "#E5E7EB" }}
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="flex-1 min-w-48 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
          />
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as "All" | Channel)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A]"
          >
            <option value="All">All Channels</option>
            <option value="Amazon">Amazon</option>
            <option value="Walmart">Walmart</option>
            <option value="Alibaba">Alibaba</option>
          </select>
          <input
            type="number"
            value={minProfit}
            onChange={(e) => setMinProfit(e.target.value)}
            placeholder="Min profit $"
            className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300"
          />
          <input
            type="number"
            value={maxBsr}
            onChange={(e) => setMaxBsr(e.target.value)}
            placeholder="Max BSR"
            className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300"
          />
          {(search || channelFilter !== "All" || minProfit || maxBsr) && (
            <button
              onClick={() => { setSearch(""); setChannelFilter("All"); setMinProfit(""); setMaxBsr(""); }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition"
            >
              Clear
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mt-3 flex items-center gap-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white" style={{ background: "#0D1B2A" }}>
              Bulk Approve
            </button>
            <button className="px-3 py-1.5 text-xs font-semibold rounded-lg border text-gray-500 border-gray-200">
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
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded accent-[#0D1B2A]"
                  />
                </th>
                {(["product", "category", "buyPrice", "sellPrice", "profit", "margin", "bsr", "channel", "aiScore", "priceType"] as (keyof Deal)[]).map((col) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
                    style={{ color: "#9CA3AF" }}
                  >
                    {col === "buyPrice" ? "Buy $" : col === "sellPrice" ? "Sell $" : col === "aiScore" ? "AI Score" : col === "priceType" ? "Type" : col.charAt(0).toUpperCase() + col.slice(1)}
                    <SortIcon col={col} />
                  </th>
                ))}
                <th className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal, i) => (
                <tr
                  key={deal.id}
                  className="border-b border-gray-50 transition-colors hover:bg-gray-50/60"
                  style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}
                >
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={selected.has(deal.id)}
                      onChange={() => setSelected((prev) => { const s = new Set(prev); s.has(deal.id) ? s.delete(deal.id) : s.add(deal.id); return s; })}
                      className="rounded accent-[#0D1B2A]"
                    />
                  </td>
                  <td className="px-4 py-3.5 font-medium max-w-52 whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: "#0D1B2A" }}>
                    {deal.product}
                  </td>
                  <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">{deal.category}</td>
                  <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.buyPrice.toFixed(2)}</td>
                  <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.sellPrice.toFixed(2)}</td>
                  <td className="px-4 py-3.5 font-semibold text-green-600 whitespace-nowrap">+${deal.profit.toFixed(2)}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="font-medium" style={{ color: "#B8922A" }}>{deal.margin.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">{deal.bsr.toLocaleString()}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <ChannelBadge channel={deal.channel} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <ScoreBadge score={deal.aiScore} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <PriceTypeBadge type={deal.priceType} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white" style={{ background: "#B8922A" }}>Buy</button>
                      <button className="px-2.5 py-1 rounded-lg text-xs font-semibold border text-gray-400 border-gray-200 hover:bg-gray-50">Skip</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No deals match your filters.</p>
            <button
              onClick={() => { setSearch(""); setChannelFilter("All"); setMinProfit(""); setMaxBsr(""); }}
              className="mt-3 text-sm font-medium"
              style={{ color: "#B8922A" }}
            >
              Clear filters
            </button>
          </div>
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

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? "#16A34A" : score >= 80 ? "#B8922A" : "#6B7280";
  const bg = score >= 90 ? "#F0FDF4" : score >= 80 ? "#FFFBEB" : "#F9FAFB";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: bg, color }}>
      ★ {score}
    </span>
  );
}

function PriceTypeBadge({ type }: { type: "Verified" | "Estimated" }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      style={type === "Verified" ? { background: "#F0FDF4", color: "#16A34A" } : { background: "#FFFBEB", color: "#D97706" }}
    >
      {type === "Verified" ? "✓ Verified" : "~ Estimated"}
    </span>
  );
}
