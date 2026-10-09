"use client";

import { useState, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type Range = "7d" | "30d" | "90d";

const CHANNEL_COLORS = [
  { name: "Amazon", color: "#FF6D00" },
  { name: "Walmart", color: "#0288D1" },
  { name: "Alibaba", color: "#E53935" },
];

interface DealsStats {
  totalToday: number;
  pendingCount: number;
  avgMargin: number;
  estTotalProfit: number;
  channelBreakdown: { amazon: number; walmart: number; alibaba: number };
}

interface Deal {
  timestamp: string;
  margin: number;
  channel: string;
}

function buildDailyData(deals: Deal[], days: number): { date: string; deals: number }[] {
  const now = Date.now();
  const buckets: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * 86400000);
    const key = days <= 7
      ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]
      : `${d.getMonth() + 1}/${d.getDate()}`;
    buckets[key] = 0;
  }
  deals.forEach((d) => {
    const date = new Date(d.timestamp);
    const diffDays = Math.floor((now - date.getTime()) / 86400000);
    if (diffDays >= days) return;
    const key = days <= 7
      ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]
      : `${date.getMonth() + 1}/${date.getDate()}`;
    if (key in buckets) buckets[key]++;
  });
  return Object.entries(buckets).reverse().map(([date, deals]) => ({ date, deals }));
}

function buildMarginData(deals: Deal[]): { range: string; count: number }[] {
  const bins = [
    { range: "20-30%", min: 20, max: 30 },
    { range: "30-40%", min: 30, max: 40 },
    { range: "40-50%", min: 40, max: 50 },
    { range: "50-60%", min: 50, max: 60 },
    { range: "60-80%", min: 60, max: 80 },
    { range: "80%+", min: 80, max: Infinity },
  ];
  return bins.map((b) => ({
    range: b.range,
    count: deals.filter((d) => d.margin >= b.min && d.margin < b.max).length,
  }));
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("30d");
  const [stats, setStats] = useState<DealsStats | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/deals/stats").then((r) => r.json()).catch(() => null),
      fetch("/api/deals").then((r) => r.json()).catch(() => []),
    ]).then(([statsData, dealsData]) => {
      setStats(statsData);
      setDeals(Array.isArray(dealsData) ? dealsData : []);
    }).finally(() => setLoading(false));
  }, []);

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const dailyData = deals.length > 0 ? buildDailyData(deals, days) : [];
  const marginData = deals.length > 0 ? buildMarginData(deals) : [];

  const channelData = stats
    ? [
        { name: "Amazon", value: stats.channelBreakdown.amazon, color: "#FF6D00" },
        { name: "Walmart", value: stats.channelBreakdown.walmart, color: "#0288D1" },
        { name: "Alibaba", value: stats.channelBreakdown.alibaba, color: "#E53935" },
      ].filter((c) => c.value > 0)
    : [];

  const totalDeals = channelData.reduce((s, c) => s + c.value, 0);
  const channelWithPct = channelData.map((c) => ({
    ...c,
    pct: totalDeals > 0 ? Math.round((c.value / totalDeals) * 100) : 0,
  }));

  const avgDailyDeals = deals.length > 0 ? (deals.length / 30).toFixed(1) : "0";
  const bestDay = dailyData.reduce((best, d) => d.deals > best.deals ? d : best, { date: "—", deals: 0 });
  const topChannel = channelWithPct.sort((a, b) => b.pct - a.pct)[0];

  const statCards = [
    { label: "Total Deals Found", value: loading ? "…" : String(stats?.totalToday ?? deals.length), delta: "all time", up: null },
    { label: "Avg Daily Deals", value: loading ? "…" : avgDailyDeals, delta: "last 30 days", up: null },
    { label: "Best Day", value: loading ? "…" : bestDay.deals > 0 ? bestDay.date : "—", delta: bestDay.deals > 0 ? `${bestDay.deals} deals` : "No data yet", up: null },
    { label: "Top Channel", value: loading ? "…" : topChannel?.name ?? "—", delta: topChannel ? `${topChannel.pct}% share` : "No data yet", up: null },
  ];

  const hasData = deals.length > 0 || stats !== null;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
            Analytics
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Performance overview across all channels</p>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white">
          {(["7d", "30d", "90d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-4 py-2 text-sm font-medium transition-all"
              style={range === r ? { background: "#0D1B2A", color: "#fff" } : { color: "#6B7280" }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 px-5 py-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{s.label}</p>
            {loading ? (
              <div className="h-7 w-20 rounded-lg bg-gray-200 animate-pulse mb-1.5" />
            ) : (
              <p className="text-2xl font-semibold" style={{ color: "#0D1B2A" }}>{s.value}</p>
            )}
            {loading ? (
              <div className="h-3 w-16 rounded bg-gray-100 animate-pulse mt-1.5" />
            ) : (
              <p className="text-xs mt-1.5 text-gray-400">{s.delta}</p>
            )}
          </div>
        ))}
      </div>

      {!hasData && !loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-20 text-center" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <p className="text-2xl mb-3">📊</p>
          <p className="text-gray-600 font-medium mb-1">No data yet</p>
          <p className="text-gray-400 text-sm">Analytics will populate as deals are scanned and processed.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Deals per Day */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Deals Found Per Day</h2>
            {loading ? (
              <div className="h-52 rounded-xl bg-gray-100 animate-pulse" />
            ) : dailyData.every((d) => d.deals === 0) ? (
              <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No activity in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dailyData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} interval={days > 30 ? 14 : days > 7 ? 4 : 0} />
                  <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                    cursor={{ stroke: "#B8922A", strokeWidth: 1, strokeDasharray: "4 4" }}
                  />
                  <Line type="monotone" dataKey="deals" stroke="#B8922A" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#B8922A" }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Channel Breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Channel Breakdown</h2>
            {loading ? (
              <div className="h-52 rounded-xl bg-gray-100 animate-pulse" />
            ) : channelWithPct.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No channel data available</div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie data={channelWithPct} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                      {channelWithPct.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [String(value), "Deals"]} contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-3">
                  {channelWithPct.map((ch) => (
                    <div key={ch.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: ch.color }} />
                          {ch.name}
                        </span>
                        <span className="font-semibold" style={{ color: "#0D1B2A" }}>{ch.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100">
                        <div className="h-full rounded-full" style={{ width: `${ch.pct}%`, background: ch.color }} />
                      </div>
                    </div>
                  ))}
                  {CHANNEL_COLORS.filter((c) => !channelWithPct.find((x) => x.name === c.name)).map((c) => (
                    <div key={c.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                          {c.name}
                        </span>
                        <span className="font-semibold text-gray-400">0%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Margin Distribution */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Margin Distribution</h2>
            {loading ? (
              <div className="h-52 rounded-xl bg-gray-100 animate-pulse" />
            ) : marginData.every((d) => d.count === 0) ? (
              <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No margin data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={marginData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="count" fill="#0D1B2A" radius={[6, 6, 0, 0]} name="Deals" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Avg Margin card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Performance Summary</h2>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {[
                  { label: "Avg Verified Margin", value: stats ? `${stats.avgMargin.toFixed(1)}%` : "—", color: (stats?.avgMargin ?? 0) >= 25 ? "#16A34A" : "#D97706" },
                  { label: "Est. Total Profit", value: stats ? `$${stats.estTotalProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—", color: "#0D1B2A" },
                  { label: "Pending Deals", value: stats ? String(stats.pendingCount) : "—", color: "#0D1B2A" },
                  { label: "Deals Scanned Today", value: stats ? String(stats.totalToday) : "—", color: "#B8922A" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "#F7F8FA" }}>
                    <span className="text-sm text-gray-500">{item.label}</span>
                    <span className="text-lg font-bold" style={{ color: item.color }}>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
