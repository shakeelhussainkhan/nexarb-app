"use client";

import { useState, useEffect } from "react";

const CHANNELS = ["All", "Amazon", "Walmart", "Alibaba", "High Confidence", "Pending"] as const;
type Channel = (typeof CHANNELS)[number];

type Deal = {
  id: number;
  rank: number;
  product: string;
  buyPrice: number;
  sellPrice: number;
  bsr: number;
  channel: "Amazon" | "Walmart" | "Alibaba";
  aiScore: number;
  priceType: "Verified" | "Estimated";
};

const DEALS: Deal[] = [
  { id: 1, rank: 1, product: "Sony WH-1000XM5 Headphones", buyPrice: 229.99, sellPrice: 348.00, bsr: 523, channel: "Amazon", aiScore: 94, priceType: "Verified" },
  { id: 2, rank: 2, product: "Instant Pot Duo 7-in-1 6Qt", buyPrice: 49.95, sellPrice: 89.99, bsr: 1240, channel: "Walmart", aiScore: 88, priceType: "Verified" },
  { id: 3, rank: 3, product: "Apple AirPods Pro (2nd Gen)", buyPrice: 189.00, sellPrice: 249.99, bsr: 340, channel: "Amazon", aiScore: 91, priceType: "Verified" },
  { id: 4, rank: 4, product: "Dyson V15 Detect Vacuum", buyPrice: 449.00, sellPrice: 649.99, bsr: 2100, channel: "Amazon", aiScore: 82, priceType: "Estimated" },
  { id: 5, rank: 5, product: "LEGO Technic McLaren F1", buyPrice: 89.00, sellPrice: 159.99, bsr: 5400, channel: "Alibaba", aiScore: 77, priceType: "Estimated" },
  { id: 6, rank: 6, product: "Ninja Foodi 10-in-1 Pressure Cooker", buyPrice: 99.00, sellPrice: 169.95, bsr: 3200, channel: "Walmart", aiScore: 85, priceType: "Verified" },
  { id: 7, rank: 7, product: "Samsung 65\" QLED 4K TV", buyPrice: 799.00, sellPrice: 1199.99, bsr: 8700, channel: "Amazon", aiScore: 79, priceType: "Estimated" },
  { id: 8, rank: 8, product: "Anker 737 Power Bank 24000mAh", buyPrice: 69.99, sellPrice: 109.99, bsr: 920, channel: "Alibaba", aiScore: 93, priceType: "Verified" },
  { id: 9, rank: 9, product: "KitchenAid Artisan Stand Mixer", buyPrice: 279.00, sellPrice: 449.99, bsr: 4300, channel: "Walmart", aiScore: 86, priceType: "Verified" },
  { id: 10, rank: 10, product: "GoPro HERO12 Black Camera", buyPrice: 299.00, sellPrice: 399.99, bsr: 1850, channel: "Amazon", aiScore: 72, priceType: "Estimated" },
  { id: 11, rank: 11, product: "Vitamix 5200 Blender", buyPrice: 349.00, sellPrice: 549.95, bsr: 9200, channel: "Alibaba", aiScore: 80, priceType: "Verified" },
  { id: 12, rank: 12, product: "Weber Spirit II E-310 Grill", buyPrice: 449.00, sellPrice: 649.00, bsr: 12400, channel: "Walmart", aiScore: 75, priceType: "Estimated" },
];

function profit(d: Deal) { return d.sellPrice - d.buyPrice; }
function margin(d: Deal) { return ((profit(d) / d.buyPrice) * 100).toFixed(1); }

const CHANNEL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Amazon: { bg: "#FFF3E0", text: "#E65100", dot: "#FF6D00" },
  Walmart: { bg: "#E3F2FD", text: "#0277BD", dot: "#0288D1" },
  Alibaba: { bg: "#FCE4EC", text: "#C62828", dot: "#E53935" },
};

type ActivityEvent = {
  id: number;
  type: "new" | "approved" | "skipped" | "alibaba";
  product: string;
  time: string;
};

const INITIAL_ACTIVITY: ActivityEvent[] = [
  { id: 1, type: "new", product: "Sony WH-1000XM5 Headphones", time: "2m ago" },
  { id: 2, type: "approved", product: "Instant Pot Duo 7-in-1", time: "5m ago" },
  { id: 3, type: "alibaba", product: "LEGO Technic McLaren F1", time: "8m ago" },
  { id: 4, type: "new", product: "Apple AirPods Pro", time: "11m ago" },
  { id: 5, type: "skipped", product: "Samsung 65\" QLED TV", time: "15m ago" },
  { id: 6, type: "approved", product: "KitchenAid Stand Mixer", time: "18m ago" },
  { id: 7, type: "new", product: "GoPro HERO12 Black", time: "22m ago" },
  { id: 8, type: "alibaba", product: "Anker 737 Power Bank", time: "31m ago" },
];

const ACTIVITY_TYPE_COLORS = {
  new: { dot: "#3B82F6", label: "New deal", prefix: "🔵" },
  approved: { dot: "#16A34A", label: "Approved", prefix: "🟢" },
  skipped: { dot: "#EF4444", label: "Skipped", prefix: "🔴" },
  alibaba: { dot: "#F59E0B", label: "Alibaba", prefix: "🟠" },
};

export default function DashboardClient() {
  const [activeFilter, setActiveFilter] = useState<Channel>("All");
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [bought, setBought] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState("2 min ago");
  const [activity, setActivity] = useState<ActivityEvent[]>(INITIAL_ACTIVITY);
  const [sortBy, setSortBy] = useState<"rank" | "aiScore" | "profit">("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    const timer = setInterval(() => {
      setActivity((prev) => {
        const types: ActivityEvent["type"][] = ["new", "new", "approved", "alibaba"];
        const products = ["Dyson V11 Vacuum", "Fitbit Sense 2", "Ninja Air Fryer XL", "Beats Studio Pro", "Logitech MX Keys"];
        const newEvent: ActivityEvent = {
          id: Date.now(),
          type: types[Math.floor(Math.random() * types.length)],
          product: products[Math.floor(Math.random() * products.length)],
          time: "just now",
        };
        return [newEvent, ...prev.slice(0, 11)];
      });
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  async function handleScan() {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 2200));
    setScanning(false);
    setLastScan("just now");
    setActivity((prev) => [{
      id: Date.now(),
      type: "new",
      product: "Scan complete — 3 new deals",
      time: "just now",
    }, ...prev.slice(0, 11)]);
  }

  const filteredDeals = DEALS.filter((d) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "High Confidence") return d.aiScore >= 88;
    if (activeFilter === "Pending") return !bought.has(d.id) && !skipped.has(d.id);
    return d.channel === activeFilter;
  }).sort((a, b) => {
    let av: number, bv: number;
    if (sortBy === "profit") { av = profit(a); bv = profit(b); }
    else if (sortBy === "aiScore") { av = a.aiScore; bv = b.aiScore; }
    else { av = a.rank; bv = b.rank; }
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const totalProfit = DEALS.reduce((s, d) => s + profit(d), 0);
  const avgMargin = DEALS.reduce((s, d) => s + parseFloat(margin(d)), 0) / DEALS.length;
  const pendingCount = DEALS.filter((d) => !bought.has(d.id) && !skipped.has(d.id)).length;
  const pendingInvestment = DEALS.filter((d) => !bought.has(d.id) && !skipped.has(d.id)).reduce((s, d) => s + d.buyPrice, 0);

  const stats = [
    { label: "Deals Today", value: DEALS.length.toString(), sub: "+3 vs yesterday", up: true, icon: "💼" },
    { label: "Pending Purchases", value: pendingCount.toString(), sub: `$${pendingInvestment.toLocaleString("en-US", { maximumFractionDigits: 0 })} investment`, up: null, icon: "⏳" },
    { label: "Avg Verified Margin", value: `${avgMargin.toFixed(1)}%`, sub: avgMargin > 25 ? "Above 25% target ✓" : "Below 25% target", up: avgMargin > 25, icon: "📈" },
    { label: "Est. Total Profit", value: `$${totalProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, sub: "If all deals executed", up: true, icon: "💰" },
  ];

  function toggleSort(col: "rank" | "aiScore" | "profit") {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  }

  return (
    <div className="p-5 lg:p-8">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
            {greeting}, Alex
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-gray-400">
              Last scan: <span className="font-medium text-gray-600">{lastScan}</span>
            </p>
            {scanning && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium animate-pulse" style={{ background: "#FFF3E0", color: "#E65100" }}>
                Scanning…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition relative">
            <BellIcon size={18} />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "#EF4444" }} />
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)" }}
          >
            {scanning ? (
              <><SpinIcon size={16} /> Scanning…</>
            ) : (
              <><ScanIcon size={16} /> Run scan now</>
            )}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-white px-4 lg:px-5 py-5 border border-gray-100" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{s.label}</p>
                <p className="text-xl lg:text-2xl font-semibold" style={{ color: "#0D1B2A" }}>{s.value}</p>
              </div>
              <span className="text-xl lg:text-2xl">{s.icon}</span>
            </div>
            <p className={`text-xs mt-2 ${s.up === true ? "text-green-500" : s.up === false ? "text-red-400" : "text-gray-400"}`}>
              {s.up === true && "↑ "}{s.sub}
            </p>
          </div>
        ))}
      </div>

      {/* Main content: table + activity feed */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Deal Pipeline */}
        <div className="flex-1 min-w-0">
          {/* Filter Bar */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {CHANNELS.map((ch) => (
              <button
                key={ch}
                onClick={() => setActiveFilter(ch)}
                className="px-3.5 py-1.5 rounded-full text-sm font-medium transition-all border"
                style={
                  activeFilter === ch
                    ? { background: "#0D1B2A", color: "#fff", borderColor: "#0D1B2A" }
                    : { background: "#fff", color: "#6B7280", borderColor: "#E5E7EB" }
                }
              >
                {ch}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-400">{filteredDeals.length} deals</span>
          </div>

          <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[
                      { key: "rank", label: "#" },
                      { key: null, label: "Product" },
                      { key: null, label: "Buy $" },
                      { key: null, label: "Sell $" },
                      { key: "profit", label: "Profit" },
                      { key: null, label: "Margin" },
                      { key: null, label: "BSR" },
                      { key: null, label: "Channel" },
                      { key: "aiScore", label: "AI Score" },
                      { key: null, label: "Type" },
                      { key: null, label: "Actions" },
                    ].map(({ key, label }) => (
                      <th
                        key={label}
                        onClick={() => key && toggleSort(key as "rank" | "aiScore" | "profit")}
                        className={`px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${key ? "cursor-pointer hover:text-gray-600 select-none" : ""}`}
                        style={{ color: "#9CA3AF" }}
                      >
                        {label}
                        {key && sortBy === key && (
                          <span className="ml-1" style={{ color: "#B8922A" }}>{sortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((deal, i) => {
                    const isBought = bought.has(deal.id);
                    const isSkipped = skipped.has(deal.id);
                    const p = profit(deal);
                    const m = margin(deal);
                    return (
                      <tr
                        key={deal.id}
                        className="border-b border-gray-50 transition-colors hover:bg-gray-50/60"
                        style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff", opacity: isSkipped ? 0.4 : 1 }}
                      >
                        <td className="px-4 py-3.5 text-xs text-gray-400 font-medium">{deal.rank}</td>
                        <td className="px-4 py-3.5 font-medium max-w-48 whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: "#0D1B2A" }}>
                          {deal.product}
                        </td>
                        <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.buyPrice.toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.sellPrice.toFixed(2)}</td>
                        <td className="px-4 py-3.5 font-semibold text-green-600 whitespace-nowrap">+${p.toFixed(2)}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="font-medium" style={{ color: "#B8922A" }}>{m}%</span>
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
                            {isBought ? (
                              <span className="text-xs font-medium text-green-600 bg-green-50 px-2.5 py-1 rounded-full">✓ Bought</span>
                            ) : isSkipped ? (
                              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">Skipped</span>
                            ) : (
                              <>
                                <button
                                  onClick={() => setBought((p) => new Set([...p, deal.id]))}
                                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white transition hover:opacity-90"
                                  style={{ background: "#B8922A" }}
                                >
                                  Buy
                                </button>
                                <button
                                  onClick={() => setSkipped((p) => new Set([...p, deal.id]))}
                                  className="px-2.5 py-1 rounded-lg text-xs font-semibold border text-gray-400 border-gray-200 hover:bg-gray-50 transition"
                                >
                                  Skip
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredDeals.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-gray-400 text-sm mb-2">No deals found for this filter.</p>
                <button onClick={() => setActiveFilter("All")} className="text-sm font-medium" style={{ color: "#B8922A" }}>
                  Show all deals
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="xl:w-72 shrink-0">
          <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>Live Activity</h2>
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {activity.map((event) => {
                const tc = ACTIVITY_TYPE_COLORS[event.type];
                return (
                  <div key={event.id} className="px-5 py-3.5 flex items-start gap-3">
                    <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: tc.dot }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium leading-snug truncate" style={{ color: "#0D1B2A" }}>{event.product}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{tc.label} · {event.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap" style={{ background: bg, color }}>
      ★ {score}
    </span>
  );
}

function PriceTypeBadge({ type }: { type: "Verified" | "Estimated" }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap"
      style={type === "Verified" ? { background: "#F0FDF4", color: "#16A34A" } : { background: "#FFFBEB", color: "#D97706" }}
    >
      {type === "Verified" ? "✓" : "~"} {type}
    </span>
  );
}

function BellIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

function ScanIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function SpinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}
