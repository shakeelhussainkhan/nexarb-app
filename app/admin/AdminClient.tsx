"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface NexarbUser {
  id: string;
  clerk_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  plan: string;
  created_at: string;
}

interface WaitlistEntry {
  id: string;
  email: string;
  created_at: string;
}

interface ServerHealth {
  status: "online" | "offline" | "checking";
  latency?: number;
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d}d ago`;
}

export default function AdminClient({
  users,
  waitlist,
}: {
  users: Record<string, unknown>[];
  waitlist: Record<string, unknown>[];
}) {
  const typedUsers = users as unknown as NexarbUser[];
  const typedWaitlist = waitlist as unknown as WaitlistEntry[];

  const [serverHealth, setServerHealth] = useState<ServerHealth>({ status: "checking" });
  const [activeTab, setActiveTab] = useState<"users" | "revenue" | "system" | "waitlist">("users");

  useEffect(() => {
    const start = Date.now();
    fetch("/api/health")
      .then((r) => {
        setServerHealth({ status: r.ok ? "online" : "offline", latency: Date.now() - start });
      })
      .catch(() => setServerHealth({ status: "offline" }));
  }, []);

  const trialCount = typedUsers.filter((u) => u.plan === "trial").length;
  const paidCount = typedUsers.filter((u) => u.plan !== "trial" && u.plan !== "free").length;
  const conversionRate = typedUsers.length > 0 ? ((paidCount / typedUsers.length) * 100).toFixed(1) : "0";

  function exportWaitlistCsv() {
    const rows = [["Email", "Joined"]];
    typedWaitlist.forEach((w) => rows.push([w.email, new Date(w.created_at).toLocaleDateString()]));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "nexarb-waitlist.csv";
    a.click();
  }

  const TABS = [
    { key: "users", label: "Users", count: typedUsers.length },
    { key: "revenue", label: "Revenue", count: null },
    { key: "system", label: "System", count: null },
    { key: "waitlist", label: "Waitlist", count: typedWaitlist.length },
  ] as const;

  return (
    <div className="min-h-screen" style={{ background: "#F7F8FA" }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition">← Dashboard</Link>
          <span className="text-gray-200">|</span>
          <h1 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>Admin Panel</h1>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#FEF3C7", color: "#D97706" }}>
          Admin Only
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Users", value: typedUsers.length, icon: "👥" },
            { label: "Trial Users", value: trialCount, icon: "⏳" },
            { label: "Paid Users", value: paidCount, icon: "💳" },
            { label: "Conversion Rate", value: `${conversionRate}%`, icon: "📈" },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-2xl border border-gray-100 px-5 py-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{kpi.label}</p>
                  <p className="text-2xl font-semibold" style={{ color: "#0D1B2A" }}>{kpi.value}</p>
                </div>
                <span className="text-2xl">{kpi.icon}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6 bg-white rounded-t-2xl overflow-hidden">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="px-6 py-3.5 text-sm font-medium transition-all border-b-2"
              style={
                activeTab === tab.key
                  ? { borderColor: "#0D1B2A", color: "#0D1B2A", background: "#fff" }
                  : { borderColor: "transparent", color: "#6B7280", background: "#fff" }
              }
            >
              {tab.label}
              {tab.count !== null && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#F3F4F6", color: "#374151" }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            {typedUsers.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-gray-400 text-sm">No users yet. Supabase nexarb_users table may be empty.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["Name", "Email", "Plan", "Joined"].map((h) => (
                        <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {typedUsers.map((u, i) => (
                      <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/60" style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                        <td className="px-5 py-3.5 font-medium" style={{ color: "#0D1B2A" }}>
                          {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="px-5 py-3.5 text-gray-500">{u.email}</td>
                        <td className="px-5 py-3.5">
                          <span
                            className="px-2.5 py-1 rounded-full text-xs font-semibold"
                            style={
                              u.plan === "trial"
                                ? { background: "#FEF3C7", color: "#D97706" }
                                : u.plan === "free"
                                ? { background: "#F3F4F6", color: "#6B7280" }
                                : { background: "#F0FDF4", color: "#16A34A" }
                            }
                          >
                            {u.plan.charAt(0).toUpperCase() + u.plan.slice(1)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 text-xs">{relTime(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Revenue Tab */}
        {activeTab === "revenue" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "Monthly Recurring Revenue", value: `$${paidCount * 99}`, note: "Based on Solo plan baseline" },
              { label: "Total Subscribers", value: String(paidCount), note: "Active paid plans" },
              { label: "Trial Users", value: String(trialCount), note: "In 14-day trial" },
              { label: "Conversion Rate", value: `${conversionRate}%`, note: "Trial to paid" },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-2xl border border-gray-100 px-6 py-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{item.label}</p>
                <p className="text-3xl font-bold mb-1" style={{ color: "#0D1B2A" }}>{item.value}</p>
                <p className="text-xs text-gray-400">{item.note}</p>
              </div>
            ))}
          </div>
        )}

        {/* System Tab */}
        {activeTab === "system" && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold mb-5" style={{ color: "#0D1B2A" }}>System Health</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium" style={{ color: "#0D1B2A" }}>ArbitrAI Server</p>
                  <p className="text-xs text-gray-400">137.184.184.27:3001</p>
                </div>
                <div className="flex items-center gap-2">
                  {serverHealth.latency && <span className="text-xs text-gray-400">{serverHealth.latency}ms</span>}
                  <span
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={
                      serverHealth.status === "online"
                        ? { background: "#F0FDF4", color: "#16A34A" }
                        : serverHealth.status === "offline"
                        ? { background: "#FEF2F2", color: "#EF4444" }
                        : { background: "#F3F4F6", color: "#9CA3AF" }
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${serverHealth.status === "online" ? "bg-green-500 animate-pulse" : serverHealth.status === "offline" ? "bg-red-500" : "bg-gray-400"}`}
                    />
                    {serverHealth.status === "checking" ? "Checking…" : serverHealth.status === "online" ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium" style={{ color: "#0D1B2A" }}>Supabase</p>
                  <p className="text-xs text-gray-400">vpskkwuvqcdprmkgvuxc.supabase.co</p>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#F3F4F6", color: "#6B7280" }}>
                  Configured
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: "#0D1B2A" }}>App Version</p>
                  <p className="text-xs text-gray-400">Next.js 16.3.0</p>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#F0FDF4", color: "#16A34A" }}>
                  Latest
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Waitlist Tab */}
        {activeTab === "waitlist" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>{typedWaitlist.length} waitlist entries</p>
              <button
                onClick={exportWaitlistCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
              >
                ↓ Export CSV
              </button>
            </div>
            {typedWaitlist.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">
                No waitlist entries yet. Check the nexarb_waitlist table in Supabase.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {typedWaitlist.map((entry) => (
                  <div key={entry.id} className="px-5 py-3 flex items-center justify-between">
                    <span className="text-sm text-gray-700">{entry.email}</span>
                    <span className="text-xs text-gray-400">{relTime(entry.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
