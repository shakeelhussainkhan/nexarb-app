"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

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

function generateMockActivity(deals: Deal[]): ActivityEvent[] {
  if (deals.length === 0) return [];
  const types: ActivityEvent["type"][] = ["routing_decision", "product_rejected", "alibaba_forward", "scan_start", "routing_decision", "routing_decision"];
  const now = Date.now();
  return deals.slice(0, 10).map((d, i) => {
    const type = types[i % types.length];
    const offsetMs = i * 3 * 60 * 1000;
    return {
      id: i,
      type,
      product: d.title,
      time: relativeTime(new Date(now - offsetMs).toISOString()),
      raw: type,
    };
  });
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardClient() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();
  const upgraded = searchParams.get("upgraded") === "true";

  const firstName = isLoaded
    ? (user?.firstName || user?.fullName?.split(" ")[0] || user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "there")
    : "there";
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
  const [countdown, setCountdown] = useState(300);

  // UI state
  const [activeFilter, setActiveFilter] = useState<ChannelFilter>("All");
  const [search, setSearch] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [undoQueue, setUndoQueue] = useState<{ asin: string; timer: ReturnType<typeof setTimeout> }[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean; type?: "success" | "error" | "info" } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState("—");
  const [sortBy, setSortBy] = useState<"profit" | "margin" | "bsr">("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(upgraded);
  const [subscription, setSubscription] = useState<{ plan: string; status: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load persisted state from localStorage
  useEffect(() => {
    try {
      const savedSkipped = localStorage.getItem("nexarb_skipped");
      const savedBought = localStorage.getItem("nexarb_bought");
      if (savedSkipped) setSkipped(new Set(JSON.parse(savedSkipped)));
      if (savedBought) setBought(new Set(JSON.parse(savedBought)));
    } catch { /* ignore */ }
  }, []);

  // ── Fetch deals ──────────────────────────────────────────────────────────────

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/deals");
      if (!res.ok) throw new Error("failed");
      const data: Deal[] = await res.json();
      setDeals(data);
      setFetchError(false);
      setLastUpdated(Date.now());
      setCountdown(300);
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
    } catch { /* keep previous stats */ }
    finally { setStatsLoading(false); }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      setServerOnline(res.ok);
    } catch {
      setServerOnline(false);
    }
  }, []);

  const fetchActivity = useCallback(async (currentDeals?: Deal[]) => {
    try {
      const res = await fetch("/api/activity");
      if (!res.ok) throw new Error("failed");
      const data: unknown = await res.json();
      const events = Array.isArray(data) ? data : [];
      if (events.length > 0) {
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
      } else {
        // Generate mock activity from current deals when server returns empty
        setActivity((prev) => {
          const src = currentDeals ?? [];
          return prev.length > 0 ? prev : generateMockActivity(src);
        });
      }
    } catch {
      setActivity((prev) => {
        if (prev.length > 0) return prev;
        const src = currentDeals ?? [];
        return generateMockActivity(src);
      });
    }
  }, []);

  // ── Mount & intervals ────────────────────────────────────────────────────────

  useEffect(() => {
    // Fetch subscription status
    fetch("/api/stripe/subscription")
      .then((r) => r.json())
      .then(({ subscription: sub }) => setSubscription(sub ?? { plan: "free", status: "inactive" }))
      .catch(() => {});

    const init = async () => {
      await fetchDeals();
      await fetchStats();
      checkHealth();
    };
    init().then(() => {
      setDeals((d) => { fetchActivity(d); return d; });
    });

    const dealsInterval = setInterval(async () => {
      await fetchDeals();
      await fetchStats();
    }, 5 * 60 * 1000);
    const healthInterval = setInterval(checkHealth, 60 * 1000);
    const activityInterval = setInterval(() => fetchActivity(), 30 * 1000);
    const tickInterval = setInterval(() => setTick((t) => t + 1), 30 * 1000);
    const countdownInterval = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);

    return () => {
      clearInterval(dealsInterval);
      clearInterval(healthInterval);
      clearInterval(activityInterval);
      clearInterval(tickInterval);
      clearInterval(countdownInterval);
    };
  }, [fetchDeals, fetchStats, checkHealth, fetchActivity]);

  // Update mock activity when deals load
  useEffect(() => {
    if (deals.length > 0 && activity.length === 0) {
      fetchActivity(deals);
    }
  }, [deals, activity.length, fetchActivity]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "/" || e.key === "s") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "r") {
        e.preventDefault();
        fetchDeals();
        fetchStats();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fetchDeals, fetchStats]);

  // ── Toast helper ─────────────────────────────────────────────────────────────

  function showToast(msg: string, ok: boolean, type: "success" | "error" | "info" = ok ? "success" : "error") {
    setToast({ msg, ok, type });
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
        setBought((p) => {
          const next = new Set([...p, asin]);
          try { localStorage.setItem("nexarb_bought", JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
        showToast("Added to purchase list!", true, "success");
      } else {
        // Add 5-second undo window
        const timer = setTimeout(() => {
          setUndoQueue((q) => q.filter((x) => x.asin !== asin));
        }, 5000);
        setUndoQueue((q) => [...q, { asin, timer }]);
        setSkipped((p) => {
          const next = new Set([...p, asin]);
          try { localStorage.setItem("nexarb_skipped", JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
        showToast("Deal skipped", false, "info");
      }
    } catch {
      showToast("Action failed — try again", false, "error");
    } finally {
      setActionLoading(null);
    }
  }

  function handleUndo(asin: string) {
    const entry = undoQueue.find((x) => x.asin === asin);
    if (entry) clearTimeout(entry.timer);
    setUndoQueue((q) => q.filter((x) => x.asin !== asin));
    setSkipped((p) => {
      const next = new Set(p);
      next.delete(asin);
      try { localStorage.setItem("nexarb_skipped", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    showToast("Deal restored", true, "info");
  }

  async function handleScan() {
    setScanning(true);
    showToast("Scan triggered! Results will appear in 2–3 minutes.", true, "info");
    try {
      await fetch("/api/scan/trigger", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
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
      if (skipped.has(d.asin)) return false;
      if (search && !d.title.toLowerCase().includes(search.toLowerCase()) && !d.asin.toLowerCase().includes(search.toLowerCase())) return false;
      if (activeFilter === "All") return true;
      if (activeFilter === "High Confidence") return d.confidence === "high";
      if (activeFilter === "Pending") return !bought.has(d.asin);
      return d.channel.toLowerCase() === activeFilter.toLowerCase();
    })
    .sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      return sortDir === "asc" ? av - bv : bv - av;
    });

  const isPaidOrTrialing = subscription && (subscription.plan !== "free" || subscription.status === "trialing" || subscription.status === "active");
  const FREE_LIMIT = 10;
  const visibleDeals = isPaidOrTrialing ? filteredDeals : filteredDeals.slice(0, FREE_LIMIT);
  const lockedCount = isPaidOrTrialing ? 0 : Math.max(0, filteredDeals.length - FREE_LIMIT);

  // ── Stat cards ───────────────────────────────────────────────────────────────

  const pendingInvestment = filteredDeals.filter((d) => !bought.has(d.asin)).reduce((s, d) => s + d.buyPrice, 0);
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

  const countdownMin = Math.floor(countdown / 60);
  const countdownSec = countdown % 60;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 lg:p-8">
      {/* Undo notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toast && (
          <div
            className="px-4 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all flex items-center gap-2"
            style={{
              background: toast.type === "success" ? "#16A34A" : toast.type === "error" ? "#EF4444" : "#0D1B2A",
              color: "#fff",
            }}
          >
            {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"} {toast.msg}
          </div>
        )}
        {undoQueue.map((u) => (
          <div
            key={u.asin}
            className="px-4 py-3 rounded-xl text-sm font-semibold shadow-lg flex items-center gap-3"
            style={{ background: "#1F2937", color: "#fff" }}
          >
            Deal skipped
            <button
              onClick={() => handleUndo(u.asin)}
              className="underline font-bold"
              style={{ color: "#B8922A" }}
            >
              Undo
            </button>
          </div>
        ))}
      </div>

      {/* Free plan upgrade prompt */}
      {subscription && !isPaidOrTrialing && !showUpgradeBanner && deals.length > FREE_LIMIT && (
        <div
          className="mb-6 px-5 py-3.5 rounded-2xl flex items-center justify-between border"
          style={{ background: "#FFFBEB", borderColor: "#FDE68A" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">⚡</span>
            <p className="text-sm font-medium" style={{ color: "#92400E" }}>
              You&apos;re on the free plan. Upgrade to see all {deals.length} deals →
            </p>
          </div>
          <a
            href="/dashboard/billing"
            className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background: "#B8922A" }}
          >
            Upgrade
          </a>
        </div>
      )}

      {/* Upgrade success banner */}
      {showUpgradeBanner && (
        <div className="mb-6 px-5 py-4 rounded-2xl flex items-center justify-between" style={{ background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)" }}>
          <div>
            <p className="text-white font-semibold text-sm">🎉 Welcome to NexArb Professional!</p>
            <p className="text-white/80 text-xs mt-0.5">Your 14-day free trial has started. Explore all deals and channels.</p>
          </div>
          <button onClick={() => setShowUpgradeBanner(false)} className="text-white/70 hover:text-white transition text-lg">×</button>
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
                {countdown > 0 && !scanning && (
                  <span className="ml-1 text-gray-300">· refresh in {countdownMin}:{String(countdownSec).padStart(2, "0")}</span>
                )}
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

          <button
            onClick={() => { fetchDeals(); fetchStats(); }}
            className="p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition"
            title="Refresh data (r)"
          >
            <RefreshIcon size={18} />
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
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{s.label}</p>
                {statsLoading ? (
                  <div className="h-7 w-20 rounded-lg bg-gray-200 animate-pulse" />
                ) : (
                  <p className="text-xl lg:text-2xl font-semibold" style={{ color: "#0D1B2A" }}>{s.value}</p>
                )}
              </div>
              <span className="text-xl lg:text-2xl ml-2 shrink-0">{s.icon}</span>
            </div>
            {statsLoading ? (
              <div className="h-3 w-28 rounded-md bg-gray-100 animate-pulse mt-2" />
            ) : (
              <p className={`text-xs mt-2 ${s.up === true ? "text-green-500" : s.up === false ? "text-red-400" : "text-gray-400"}`}>
                {s.up === true && "↑ "}{s.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Deal Pipeline */}
        <div className="flex-1 min-w-0">
          {/* Filter Bar + Search */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
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
            {/* Search */}
            <div className="relative">
              <SearchIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products… (press / to focus)"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm outline-none focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition"
                >
                  ×
                </button>
              )}
            </div>
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
                    : visibleDeals.map((deal, i) => {
                        const isActioning = actionLoading === deal.asin + "buy" || actionLoading === deal.asin + "skip";
                        const isBought = bought.has(deal.asin);
                        const channelKey = deal.channel.toLowerCase();
                        const channelColor = CHANNEL_COLORS[channelKey] ?? { bg: "#F5F5F5", text: "#616161", dot: "#9E9E9E" };
                        return (
                          <tr
                            key={deal.id}
                            className="border-b border-gray-50 transition-all hover:bg-gray-50/60"
                            style={{
                              background: isBought ? "#F0FDF4" : i % 2 === 1 ? "#FAFAFA" : "#fff",
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
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleAction(deal.asin, "buy")}
                                      disabled={isActioning}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                                      style={{ background: "#B8922A" }}
                                      title="Buy this deal (b)"
                                    >
                                      {isActioning && actionLoading === deal.asin + "buy" ? "…" : "Buy"}
                                    </button>
                                    <button
                                      onClick={() => handleAction(deal.asin, "skip")}
                                      disabled={isActioning}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-gray-400 border-gray-200 hover:bg-gray-50 transition disabled:opacity-50"
                                      title="Skip deal (s)"
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

            {/* Locked rows for free users */}
            {!dealsLoading && lockedCount > 0 && (
              <div className="relative px-4 py-8 border-t border-gray-100">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/95 pointer-events-none" />
                <div className="text-center relative z-10">
                  <p className="text-sm font-semibold mb-1" style={{ color: "#0D1B2A" }}>
                    {lockedCount} more deals hidden
                  </p>
                  <p className="text-xs text-gray-400 mb-3">
                    You&apos;re on the free plan. Upgrade to see all {filteredDeals.length} deals →
                  </p>
                  <a
                    href="/dashboard/billing"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)" }}
                  >
                    Upgrade to unlock all deals
                  </a>
                </div>
              </div>
            )}

            {!dealsLoading && filteredDeals.length === 0 && (
              <div className="py-16 text-center">
                {search ? (
                  <>
                    <p className="text-gray-400 text-sm mb-2">No deals match &ldquo;{search}&rdquo;</p>
                    <button onClick={() => setSearch("")} className="text-sm font-medium" style={{ color: "#B8922A" }}>
                      Clear search
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-gray-400 text-sm mb-2">No deals match your filters.</p>
                    <button onClick={() => setActiveFilter("All")} className="text-sm font-medium" style={{ color: "#B8922A" }}>
                      Show all deals
                    </button>
                  </>
                )}
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
                <div className="px-5 py-8 text-center">
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="mt-1 w-2 h-2 rounded-full bg-gray-200 animate-pulse shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 rounded bg-gray-200 animate-pulse" />
                          <div className="h-2.5 w-2/3 rounded bg-gray-100 animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-300 mt-4">Activity will appear here as deals are processed.</p>
                </div>
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

          {/* Keyboard shortcuts hint */}
          <div className="mt-4 px-4 py-3 rounded-xl border border-gray-100 bg-white">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Shortcuts</p>
            <div className="space-y-1 text-xs text-gray-400">
              <div className="flex justify-between"><span>Focus search</span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">/</kbd></div>
              <div className="flex justify-between"><span>Refresh data</span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">R</kbd></div>
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

function RefreshIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" color="#6B7280">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}

function SearchIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
