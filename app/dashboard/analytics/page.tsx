"use client";

import { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

type Range = "7d" | "30d" | "90d";

const DAILY_30D = Array.from({ length: 30 }, (_, i) => ({
  date: `Jul ${i + 1}`,
  deals: Math.floor(Math.random() * 15 + 5),
}));

const DAILY_7D = DAILY_30D.slice(23).map((d, i) => ({ ...d, date: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] }));
const DAILY_90D = Array.from({ length: 90 }, (_, i) => ({ date: `Day ${i + 1}`, deals: Math.floor(Math.random() * 18 + 3) }));

const CHANNEL_DATA = [
  { name: "Amazon", value: 48, color: "#FF6D00" },
  { name: "Walmart", value: 31, color: "#0288D1" },
  { name: "Alibaba", value: 21, color: "#E53935" },
];

const MARGIN_DATA = [
  { range: "20-30%", count: 8 },
  { range: "30-40%", count: 14 },
  { range: "40-50%", count: 22 },
  { range: "50-60%", count: 18 },
  { range: "60-80%", count: 11 },
  { range: "80%+", count: 5 },
];

const CATEGORY_DATA = [
  { name: "Electronics", deals: 34 },
  { name: "Kitchen", deals: 28 },
  { name: "Home", deals: 19 },
  { name: "Toys", deals: 14 },
  { name: "Outdoor", deals: 11 },
  { name: "Beauty", deals: 9 },
  { name: "Automotive", deals: 6 },
].sort((a, b) => b.deals - a.deals);

const STATS = [
  { label: "Total Deals Found", value: "1,247", delta: "+18%", up: true },
  { label: "Avg Daily Deals", value: "41.6", delta: "+5%", up: true },
  { label: "Best Day", value: "Jul 22", delta: "67 deals", up: null },
  { label: "Top Channel", value: "Amazon", delta: "48% share", up: null },
];

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("30d");

  const dailyData = range === "7d" ? DAILY_7D : range === "90d" ? DAILY_90D : DAILY_30D;

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
        {STATS.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 px-5 py-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: "#0D1B2A" }}>{s.value}</p>
            <p className={`text-xs mt-1.5 ${s.up === true ? "text-green-500" : s.up === false ? "text-red-400" : "text-gray-400"}`}>
              {s.delta}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deals per Day */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Deals Found Per Day</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} interval={range === "90d" ? 14 : range === "30d" ? 4 : 0} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
                cursor={{ stroke: "#B8922A", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Line type="monotone" dataKey="deals" stroke="#B8922A" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#B8922A" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Channel Breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Channel Breakdown</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie
                  data={CHANNEL_DATA}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {CHANNEL_DATA.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value}%`, ""]} contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-3">
              {CHANNEL_DATA.map((ch) => (
                <div key={ch.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: ch.color }} />
                      {ch.name}
                    </span>
                    <span className="font-semibold" style={{ color: "#0D1B2A" }}>{ch.value}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100">
                    <div className="h-full rounded-full" style={{ width: `${ch.value}%`, background: ch.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Margin Distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Margin Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MARGIN_DATA} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="count" fill="#0D1B2A" radius={[6, 6, 0, 0]} name="Deals" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Categories */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>Top Categories</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={CATEGORY_DATA} layout="vertical" margin={{ top: 0, right: 10, left: 50, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={false} width={60} />
              <Tooltip contentStyle={{ border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="deals" fill="#B8922A" radius={[0, 6, 6, 0]} name="Deals" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
