"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@clerk/nextjs";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Deal {
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
}

interface DealsStats {
  totalToday: number;
  pendingCount: number;
  avgMargin: number;
  estTotalProfit: number;
  channelBreakdown: { amazon: number; walmart: number; alibaba: number };
}

interface ActivityEvent {
  id: number;
  type: "routing_decision" | "product_rejected" | "alibaba_forward" | "scan_start" | "unknown";
  product: string;
  time: string;
  raw: string;
}

const CHANNELS = ["All", "Amazon", "Walmart", "Alibaba", "High Confidence", "Pending"] as const;
type ChannelFilter = (typeof CHANNELS)[number];

const CHANNEL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  amazon: { bg: "#FFF3E0", text: "#E65100", dot: "#FF6D00" },
  walmart: { bg: "#E3F2FD", text: "#0277BD", dot: "#0288D1" },
  alibaba: { bg: "#FCE4EC", text: "#C62828", dot: "#E53935" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatLastUpdated(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  return `${m} min ago`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardClient() {
  const { user, isLoaded } = useUser();
  const firstName = isLoaded ? (user?.firstName || user?.fullName?.split(" ")[0] || "there") : "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Data state
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stats, setStats] = useState<DealsStats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [, setTick] = useState(0);

  // UI state
  const [activeFilter, setActiveFilter] = useState<ChannelFilter>("All");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState("—");
  const [sortBy, setSortBy] = useState<"profit" | "margin" | "bsr">("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch deals ──────────────────────────────────────────────────────────────

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/deals");
      if (!res.ok) throw new Error("failed");
      const data: Deal[] = await res.json();
      setDeals(data);
      setFetchError(false);
      setLastUpdated(Date.now());
    } catch {
      setFetchError(true);
    } finally {
      setDealsLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/deals/stats");
      if (!res.ok) throw new Error("failed");
      const data: DealsStats = await res.json();
      setStats(data);
    } catch {
      // keep previous stats
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      setServerOnline(res.ok);
    } catch {
      setServerOnline(false);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("http://137.184.184.27:3004/events", {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error("failed");
      const data: unknown = await res.json();
      const events = Array.isArray(data) ? data : [];
      setActivity(
        events.slice(0, 20).map((e: unknown, idx: number) => {
          const ev = e as Record<string, unknown>;
          const d = (ev.data as Record<string, unknown>) || {};
          return {
            id: idx,
            type: (ev.type as ActivityEvent["type"]) || "unknown",
            product: (d.title as string) || (d.asin as string) || "Unknown product",
            time: relativeTime((ev.timestamp as string) || new Date().toISOString()),
            raw: ev.type as string,
          };
        })
      );
    } catch {
      // keep existing activity if any
    }
  }, []);

  // ── Mount & intervals ────────────────────────────────────────────────────────

  useEffect(() => {
    fetchDeals();
    fetchStats();
    checkHealth();
    fetchActivity();

    const dealsInterval = setInterval(() => { fetchDeals(); fetchStats(); }, 5 * 60 * 1000);
    const healthInterval = setInterval(checkHealth, 60 * 1000);
    const activityInterval = setInterval(fetchActivity, 30 * 1000);
    const tickInterval = setInterval(() => setTick((t) => t + 1), 30 * 1000);

    return () => {
      clearInterval(dealsInterval);
      clearInterval(healthInterval);
      clearInterval(activityInterval);
      clearInterval(tickInterval);
    };
  }, [fetchDeals, fetchStats, checkHealth, fetchActivity]);

  // ── Toast helper ─────────────────────────────────────────────────────────────

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleAction(asin: string, action: "buy" | "skip") {
    setActionLoading(asin + action);
    try {
      const res = await fetch("/api/deals/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, action }),
      });
      if (!res.ok) throw new Error("failed");
      if (action === "buy") {
        setBought((p) => new Set([...p, asin]));
        showToast("Added to purchase list!", true);
      } else {
        setSkipped((p) => new Set([...p, asin]));
        showToast("Deal skipped", false);
      }
    } catch {
      showToast("Action failed — try again", false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      await fetch("http://137.184.184.27:3001/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual_scan" }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* best-effort */ }
    setTimeout(async () => {
      await fetchDeals();
      await fetchStats();
      setScanning(false);
      setLastScan("just now");
    }, 3000);
  }

  function toggleSort(col: "profit" | "margin" | "bsr") {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  }

  // ── Filter & sort ────────────────────────────────────────────────────────────

  const filteredDeals = deals
    .filter((d) => {
      if (bought.has(d.asin) || skipped.has(d.asin)) return false;
      if (activeFilter === "All") return true;
      if (activeFilter === "High Confidence") return d.confidence === "high";
      if (activeFilter === "Pending") return true;
      return d.channel.toLowerCase() === activeFilter.toLowerCase();
    })
    .sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      return sortDir === "asc" ? av - bv : bv - av;
    });

  // ── Stat cards ───────────────────────────────────────────────────────────────

  const pendingInvestment = filteredDeals.reduce((s, d) => s + d.buyPrice, 0);
  const statCards = [
    {
      label: "Deals Today",
      value: statsLoading ? "…" : String(stats?.totalToday ?? 0),
      sub: `${stats?.pendingCount ?? 0} pending`,
      up: true,
      icon: "💼",
    },
    {
      label: "Pending Purchases",
      value: statsLoading ? "…" : String(stats?.pendingCount ?? 0),
      sub: `$${pendingInvestment.toLocaleString("en-US", { maximumFractionDigits: 0 })} investment`,
      up: null,
      icon: "⏳",
    },
    {
      label: "Avg Verified Margin",
      value: statsLoading ? "…" : `${stats?.avgMargin?.toFixed(1) ?? "0"}%`,
      sub: (stats?.avgMargin ?? 0) > 25 ? "Above 25% target ✓" : "Below 25% target",
      up: (stats?.avgMargin ?? 0) > 25,
      icon: "📈",
    },
    {
      label: "Est. Total Profit",
      value: statsLoading
        ? "…"
        : `$${(stats?.estTotalProfit ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      sub: "If all pending executed",
      up: true,
      icon: "💰",
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 lg:p-8">
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all"
          style={{ background: toast.ok ? "#16A34A" : "#0D1B2A", color: "#fff" }}
        >
          {toast.msg}
        </div>
      )}

      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-xl lg:text-2xl font-semibold"
            style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}
          >
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {email && <p className="text-xs text-gray-400">{email}</p>}
            {lastScan !== "—" && (
              <p className="text-sm text-gray-400">
                Last scan: <span className="font-medium text-gray-600">{lastScan}</span>
              </p>
            )}
            {lastUpdated > 0 && (
              <p className="text-xs text-gray-400">
                Updated: <span className="font-medium text-gray-600">{formatLastUpdated(lastUpdated)}</span>
              </p>
            )}
            {scanning && (
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium animate-pulse"
                style={{ background: "#FFF3E0", color: "#E65100" }}
              >
                Scanning…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Health indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium">
            <span
              className={`w-2 h-2 rounded-full ${serverOnline === true ? "bg-green-500 animate-pulse" : serverOnline === false ? "bg-red-500" : "bg-gray-300"}`}
            />
            <span style={{ color: serverOnline === true ? "#16A34A" : serverOnline === false ? "#EF4444" : "#9CA3AF" }}>
              {serverOnline === true ? "ArbitrAI Online" : serverOnline === false ? "ArbitrAI Offline" : "Checking…"}
            </span>
          </div>

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
            {scanning ? <><SpinIcon size={16} /> Scanning…</> : <><ScanIcon size={16} /> Run scan now</>}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {fetchError && (
        <div
          className="mb-6 px-4 py-3 rounded-xl text-sm font-medium border"
          style={{ background: "#FFF3E0", color: "#E65100", borderColor: "#FBBF24" }}
        >
          ⚠️ Could not connect to ArbitrAI server. Showing cached data.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl bg-white px-4 lg:px-5 py-5 border border-gray-100"
            style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{s.label}</p>
                {statsLoading ? (
                  <div className="h-7 w-20 rounded-lg bg-gray-200 animate-pulse" />
                ) : (
                  <p className="text-xl lg:text-2xl font-semibold" style={{ color: "#0D1B2A" }}>{s.value}</p>
                )}
              </div>
              <span className="text-xl lg:text-2xl">{s.icon}</span>
            </div>
            <p className={`text-xs mt-2 ${s.up === true ? "text-green-500" : s.up === false ? "text-red-400" : "text-gray-400"}`}>
              {s.up === true && "↑ "}{s.sub}
            </p>
          </div>
        ))}
      </div>

      {/* Main content */}
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

          <div
            className="rounded-2xl bg-white border border-gray-100 overflow-hidden"
            style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {(
                      [
                        { key: null, label: "#" },
                        { key: null, label: "Product" },
                        { key: null, label: "Buy $" },
                        { key: null, label: "Sell $" },
                        { key: "profit", label: "Profit" },
                        { key: "margin", label: "Margin" },
                        { key: "bsr", label: "BSR" },
                        { key: null, label: "Channel" },
                        { key: null, label: "Confidence" },
                        { key: null, label: "Price" },
                        { key: null, label: "Actions" },
                      ] as { key: string | null; label: string }[]
                    ).map(({ key, label }) => (
                      <th
                        key={label}
                        onClick={() => key && toggleSort(key as "profit" | "margin" | "bsr")}
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
                  {dealsLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-gray-50" style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                          {Array.from({ length: 11 }).map((__, j) => (
                            <td key={j} className="px-4 py-3.5">
                              <div
                                className="h-4 rounded-md bg-gray-200 animate-pulse"
                                style={{ width: j === 1 ? "140px" : j === 10 ? "80px" : "60px" }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))
                    : filteredDeals.map((deal, i) => {
                        const isActioning = actionLoading === deal.asin + "buy" || actionLoading === deal.asin + "skip";
                        const isBought = bought.has(deal.asin);
                        const isSkipped = skipped.has(deal.asin);
                        const channelKey = deal.channel.toLowerCase();
                        const channelColor = CHANNEL_COLORS[channelKey] ?? { bg: "#F5F5F5", text: "#616161", dot: "#9E9E9E" };
                        return (
                          <tr
                            key={deal.id}
                            className="border-b border-gray-50 transition-colors hover:bg-gray-50/60"
                            style={{
                              background: isBought ? "#F0FDF4" : i % 2 === 1 ? "#FAFAFA" : "#fff",
                              opacity: isSkipped ? 0.4 : 1,
                            }}
                          >
                            <td className="px-4 py-3.5 text-xs text-gray-400 font-medium">{i + 1}</td>
                            <td className="px-4 py-3.5 max-w-48">
                              <a
                                href={`https://www.amazon.com/dp/${deal.asin}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium leading-snug hover:underline block truncate"
                                style={{ color: "#0D1B2A" }}
                                title={deal.title}
                              >
                                {deal.title}
                              </a>
                              <p className="text-[11px] text-gray-400 mt-0.5">{deal.asin}</p>
                            </td>
                            <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.buyPrice.toFixed(2)}</td>
                            <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">${deal.sellPrice.toFixed(2)}</td>
                            <td className="px-4 py-3.5 font-semibold text-green-600 whitespace-nowrap">+${deal.profit.toFixed(2)}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span
                                className="font-semibold"
                                style={{
                                  color: deal.margin >= 25 ? "#16A34A" : deal.margin >= 15 ? "#D97706" : "#EF4444",
                                }}
                              >
                                {deal.margin.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">{deal.bsr.toLocaleString()}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                                style={{ background: channelColor.bg, color: channelColor.text }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: channelColor.dot }} />
                                {deal.channel.charAt(0).toUpperCase() + deal.channel.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <ConfidenceBadge confidence={deal.confidence} />
                            </td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <PriceTypeBadge verified={deal.verifiedPrice} />
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
                                      onClick={() => handleAction(deal.asin, "buy")}
                                      disabled={isActioning}
                                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                                      style={{ background: "#B8922A" }}
                                    >
                                      {isActioning ? "…" : "Buy"}
                                    </button>
                                    <button
                                      onClick={() => handleAction(deal.asin, "skip")}
                                      disabled={isActioning}
                                      className="px-2.5 py-1 rounded-lg text-xs font-semibold border text-gray-400 border-gray-200 hover:bg-gray-50 transition disabled:opacity-50"
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

            {!dealsLoading && filteredDeals.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-gray-400 text-sm mb-2">No deals found for this filter.</p>
                <button
                  onClick={() => setActiveFilter("All")}
                  className="text-sm font-medium"
                  style={{ color: "#B8922A" }}
                >
                  Show all deals
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="xl:w-72 shrink-0">
          <div
            className="rounded-2xl bg-white border border-gray-100 overflow-hidden"
            style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>Live Activity</h2>
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Live
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {activity.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-gray-400">No recent activity</div>
              ) : (
                activity.map((event) => {
                  const dotColor =
                    event.type === "routing_decision"
                      ? "#3B82F6"
                      : event.type === "product_rejected"
                      ? "#EF4444"
                      : event.type === "alibaba_forward"
                      ? "#F59E0B"
                      : "#16A34A";
                  const label =
                    event.type === "routing_decision"
                      ? "Routed"
                      : event.type === "product_rejected"
                      ? "Rejected"
                      : event.type === "alibaba_forward"
                      ? "Alibaba"
                      : event.type === "scan_start"
                      ? "Scan"
                      : "Event";
                  return (
                    <div key={event.id} className="px-5 py-3.5 flex items-start gap-3">
                      <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-snug truncate" style={{ color: "#0D1B2A" }}>
                          {event.product}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {label} · {event.time}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const c = confidence.toLowerCase();
  const color = c === "high" ? "#16A34A" : c === "medium" ? "#D97706" : "#6B7280";
  const bg = c === "high" ? "#F0FDF4" : c === "medium" ? "#FFFBEB" : "#F9FAFB";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ background: bg, color }}
    >
      ★ {c.charAt(0).toUpperCase() + c.slice(1)}
    </span>
  );
}

function PriceTypeBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap"
      style={verified ? { background: "#F0FDF4", color: "#16A34A" } : { background: "#FFFBEB", color: "#D97706" }}
    >
      {verified ? "✓ Verified" : "~ Estimated"}
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
