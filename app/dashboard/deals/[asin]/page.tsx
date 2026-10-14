"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PurchaseGuard from "@/components/PurchaseGuard";
import HistoryPanel from "@/components/HistoryPanel";

type Velocity = {
  unitsPerDay: number | null;
  confidence: "low" | "medium" | "high" | "unknown";
  trend: "improving" | "declining" | "stable" | "insufficient";
  snapshotCount: number;
  spanDays: number;
  basis: string;
};

type DealChannel = {
  channel: "amazon-fba" | "walmart-wfs";
  sellPrice: number | null;
  sellPriceSource: string;
  netProfit: number;
  marginPct: number;
  verdict: "BUY" | "SKIP" | "UNKNOWN";
};

type Deal = {
  id: number;
  asin: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
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
    netProfitAtRealistic: number;
    marginAtRealistic: number;
    estMonthlySales: number;
    daysToClear: number | null;
    suggestedQty: number;
    velocity: Velocity;
    channels: DealChannel[];
    chosenChannel: "amazon-fba" | "walmart-wfs" | null;
  };
};

type DealDetail = {
  asin: string;
  onWatchlist: boolean;
  deal: Deal | null;
  eligibility: string;
  source: { buySource: string; sourceUrl: string | null; retailerLabel: string } | null;
  watchlist: {
    discoveryTitle: string;
    category: string | null;
    active: boolean;
    addedAt: string;
  } | null;
  recentChecks: Array<{
    checkedAt: string;
    buyPrice: number;
    sellPrice: number | null;
    verdict: "BUY" | "SKIP" | "UNKNOWN";
    eligibility: string;
    netProfit: number | null;
    marginPct: number | null;
    floorPrice: number | null;
  }>;
  buybox: Array<{
    checkedAt: string;
    sellPrice: number | null;
    winner: "us" | "competitor" | "unknown";
  }>;
  approval: {
    status: "pending" | "applied" | "dismissed";
    approvalUrl: string;
    channel: string;
    netPerUnit: number;
    marginPct: number;
    buyPrice: number | null;
    sellPrice: number | null;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
};

const TREND_STYLE: Record<string, { arrow: string; color: string }> = {
  improving: { arrow: "↑", color: "#16A34A" },
  declining: { arrow: "↓", color: "#DC2626" },
  stable: { arrow: "→", color: "#9CA3AF" },
  insufficient: { arrow: "", color: "#9CA3AF" },
};

const ELIGIBILITY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  SELLABLE: { bg: "#F0FDF4", color: "#16A34A", label: "Sellable" },
  APPROVAL_REQUIRED: { bg: "#FFFBEB", color: "#D97706", label: "Approval required" },
  BLOCKED: { bg: "#FEF2F2", color: "#DC2626", label: "Blocked" },
  UNKNOWN: { bg: "#F9FAFB", color: "#6B7280", label: "Eligibility unknown" },
};

function fmtUnitsPerDay(u: number): string {
  return u >= 100 ? String(Math.round(u)) : String(Math.round(u * 10) / 10);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function money(v: number | null): string {
  return v === null ? "—" : `$${v.toFixed(2)}`;
}

export default function DealDetailPage() {
  const params = useParams<{ asin: string }>();
  const router = useRouter();
  const asin = (params?.asin ?? "").toUpperCase();
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [intentCreated, setIntentCreated] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(asin)}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error("failed");
      setDetail((await res.json()) as DealDetail);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [asin]);

  useEffect(() => {
    if (asin) fetchDetail();
  }, [asin, fetchDetail]);

  // Same guarded intent creation as the deals list: POST /api/purchases
  // records a PENDING_APPROVAL intent only; the server re-checks verdict,
  // eligibility, spend caps and the kill switch (422 + reasons on block).
  async function createPurchaseIntent(deal: Deal) {
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: deal.asin,
          qty: deal.engine.suggestedQty,
          unitPrice: deal.buyPrice,
          buyPrice: deal.buyPrice,
          sellPrice: deal.sellPrice,
          bsr: deal.bsr,
          category: deal.category,
        }),
      });
      const data = (await res.json()) as { reasons?: string[]; warning?: string };
      if (res.status === 422) {
        setNotice(`Purchase blocked for ${deal.asin}: ${(data.reasons ?? ["guardrail block"]).join(" ")}`);
        return;
      }
      if (!res.ok) throw new Error("failed");
      setIntentCreated(true);
      setNotice(data.warning ?? `Intent recorded for ${deal.asin} — awaiting approval. Nothing purchased yet.`);
    } catch {
      setNotice(`Could not record intent for ${deal.asin} — the server didn't confirm. Nothing was purchased.`);
    }
  }

  async function skipDeal() {
    setSkipping(true);
    try {
      const res = await fetch("/api/deals/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, action: "skip" }),
      });
      if (!res.ok) throw new Error("failed");
      router.push("/dashboard/deals");
    } catch {
      setNotice(`Could not record skip for ${asin} — the deal server didn't confirm. Nothing was removed.`);
      setSkipping(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-gray-400 text-sm">Loading deal…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-6 lg:p-8">
        <BackLink />
        <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <p className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>Not on the watchlist</p>
          <p className="text-sm text-gray-400 mt-2">
            <span className="font-mono">{asin}</span> has no watchlist row and no recorded checks, so there is nothing to show yet.
          </p>
          <Link href="/dashboard/deals" className="inline-block mt-4 text-sm font-semibold hover:underline" style={{ color: "#B8922A" }}>
            ← Back to all deals
          </Link>
        </div>
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div className="p-6 lg:p-8">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The deal server didn't respond, so this deal can't be shown.
          <button onClick={() => { setLoading(true); setLoadError(false); fetchDetail(); }} className="ml-3 font-semibold underline">Retry</button>
        </div>
      </div>
    );
  }

  const deal = detail.deal;
  const title = deal?.title ?? detail.watchlist?.discoveryTitle ?? detail.asin;
  const brand = deal?.brand ?? null;
  const imageUrl = deal?.imageUrl ?? null;
  const eligStyle = ELIGIBILITY_STYLE[detail.eligibility] ?? ELIGIBILITY_STYLE.UNKNOWN;
  const recordedBuyBox = detail.buybox.filter((b) => b.winner !== "unknown");

  return (
    <div className="p-6 lg:p-8">
      <BackLink />

      {notice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="flex flex-col md:flex-row md:items-start gap-5">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="w-24 h-24 shrink-0 rounded-xl border border-gray-100 object-contain bg-white"
              />
            ) : (
              <div className="w-24 h-24 shrink-0 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center text-gray-300 text-xs">
                No image
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold leading-snug" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
                {title}
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                {brand ? `${brand} · ` : ""}
                <span className="font-mono">{detail.asin}</span>
                {detail.onWatchlist && detail.watchlist ? ` · on watchlist since ${fmtDateTime(detail.watchlist.addedAt)}` : " · not on the watchlist"}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {deal && <VerdictBadge verdict={deal.engine.verdict} />}
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap" style={{ background: eligStyle.bg, color: eligStyle.color }}>
                  {eligStyle.label}
                </span>
                {deal && (
                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap bg-gray-50 text-gray-500">
                    Channel: {deal.channel} · {deal.verifiedPrice ? "✓ Verified price" : "~ Estimated price"}
                  </span>
                )}
                <a
                  href={`https://www.amazon.com/dp/${detail.asin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold hover:underline"
                  style={{ color: "#B8922A" }}
                >
                  View on Amazon ↗
                </a>
              </div>
            </div>
          </div>
          {deal && (
            <div className="shrink-0">
              {intentCreated ? (
                <span className="text-xs font-medium text-green-600 bg-green-50 px-3 py-1.5 rounded-full whitespace-nowrap">
                  Intent created · Pending approval
                </span>
              ) : (
                <div className="flex items-start gap-1.5">
                  <PurchaseGuard
                    verdict={deal.engine.verdict}
                    reasons={deal.engine.reasons}
                    asin={deal.asin}
                    onConfirm={() => createPurchaseIntent(deal)}
                  />
                  <button
                    onClick={skipDeal}
                    disabled={skipping}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold border text-gray-400 border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {skipping ? "…" : "Skip"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!deal && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
          <p className="text-sm text-gray-500">
            This ASIN is on the watchlist but the engine hasn't checked it yet — economics and a verdict appear after the next scan.
          </p>
        </div>
      )}

      {deal && (
        <>
          {/* Economics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <StatCard label="Buy price">
              <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>${deal.buyPrice.toFixed(2)}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5">
                {detail.source ? `from ${detail.source.retailerLabel}` : ""}
                {detail.source?.sourceUrl && (
                  <>
                    {" · "}
                    <a href={detail.source.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline" style={{ color: "#B8922A" }}>
                      Source listing ↗
                    </a>
                  </>
                )}
              </span>
            </StatCard>
            <StatCard label="Sell price">
              <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>${deal.sellPrice.toFixed(2)}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5">{deal.verifiedPrice ? "Verified via SP-API pricing" : "Estimated — no live price"}</span>
            </StatCard>
            <StatCard label="Floor price">
              <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>${deal.engine.floorPrice.toFixed(2)}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5">Lowest sell price that still clears the bar</span>
            </StatCard>
            <StatCard label="Net @ sell">
              <span className="text-lg font-semibold" style={{ color: deal.engine.netProfitAtRealistic >= 0 ? "#16A34A" : "#DC2626" }}>
                {deal.engine.netProfitAtRealistic >= 0 ? "+" : "−"}${Math.abs(deal.engine.netProfitAtRealistic).toFixed(2)}
              </span>
              <span className="block text-[11px] text-gray-400 mt-0.5">{deal.engine.marginAtRealistic.toFixed(1)}% margin</span>
            </StatCard>
            <StatCard label="BSR">
              <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>{deal.bsr ? deal.bsr.toLocaleString() : "—"}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5">Latest ranked snapshot</span>
            </StatCard>
            <StatCard label="Velocity">
              {deal.engine.velocity.unitsPerDay === null ? (
                <>
                  <span className="text-lg font-semibold text-gray-400">n/a</span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">{deal.engine.velocity.basis}</span>
                </>
              ) : (
                <>
                  <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>
                    ~{fmtUnitsPerDay(deal.engine.velocity.unitsPerDay)}/day{" "}
                    <span style={{ color: TREND_STYLE[deal.engine.velocity.trend].color }}>{TREND_STYLE[deal.engine.velocity.trend].arrow}</span>
                  </span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">
                    {deal.engine.velocity.trend} · {deal.engine.velocity.confidence} conf. · {deal.engine.velocity.basis}
                  </span>
                </>
              )}
            </StatCard>
            <StatCard label="Suggested qty">
              <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>{deal.engine.suggestedQty}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5">Units per intent at current prices</span>
            </StatCard>
            <StatCard label="Last checked">
              <span className="text-lg font-semibold" style={{ color: "#0D1B2A" }}>{fmtDateTime(deal.timestamp)}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5">Confidence: {deal.confidence}</span>
            </StatCard>
          </div>

          {/* Verdict reasoning */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Why this verdict</h2>
            <p className="text-sm text-gray-600 mb-2">
              {deal.engine.chosenChannel
                ? <>Chosen channel: <strong style={{ color: "#0D1B2A" }}>{deal.engine.chosenChannel === "amazon-fba" ? "Amazon FBA" : "Walmart WFS"}</strong></>
                : "No channel is BUY-eligible at the target margin/velocity window."}
            </p>
            {deal.engine.reasons.length > 0 && (
              <ul className="list-disc pl-5 space-y-1 mb-4">
                {deal.engine.reasons.map((r, i) => (
                  <li key={i} className="text-sm text-gray-500">{r}</li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {["Channel", "Sell $", "Net", "Margin", "Verdict"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deal.engine.channels.map((c) => (
                    <tr key={c.channel} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-600">{c.channel === "amazon-fba" ? "Amazon FBA" : "Walmart WFS"}</td>
                      <td className="px-3 py-2 text-gray-600">{money(c.sellPrice)}</td>
                      <td className="px-3 py-2 text-gray-600">{c.sellPrice === null ? "—" : `${c.netProfit >= 0 ? "+" : "−"}$${Math.abs(c.netProfit).toFixed(2)}`}</td>
                      <td className="px-3 py-2 text-gray-600">{c.sellPrice === null ? "—" : `${c.marginPct.toFixed(1)}%`}</td>
                      <td className="px-3 py-2"><VerdictBadge verdict={c.verdict} small /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Walmart WFS shows unavailable until a real competitive-pricing source exists — the seller API exposes none.
            </p>
          </div>

          {/* Approval / eligibility */}
          {detail.eligibility === "APPROVAL_REQUIRED" && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700 mb-2">Amazon approval required</h2>
              <p className="text-sm text-amber-800">
                This ASIN is gated on your seller account — Amazon requires an approval application before you can list it.
                Buying is not blocked here, but the stock can't be listed until the application is approved.
              </p>
              {detail.approval ? (
                <div className="mt-3 text-sm text-amber-800 space-y-1">
                  <p>
                    Approval queue:{" "}
                    <strong>{detail.approval.status}</strong>
                    {" · "}net {detail.approval.netPerUnit >= 0 ? "+" : "−"}${Math.abs(detail.approval.netPerUnit).toFixed(2)}/unit at {detail.approval.marginPct.toFixed(1)}% margin
                    {" · "}first seen {fmtDateTime(detail.approval.firstSeenAt)}
                  </p>
                  <p className="flex flex-wrap gap-4">
                    <a href={detail.approval.approvalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                      Open Amazon approval application ↗
                    </a>
                    <Link href="/dashboard/approvals" className="font-semibold underline">
                      Manage in Approvals →
                    </Link>
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-amber-800">
                  Not in the approval queue yet — the queue only takes gated items with net &gt; $0, margin ≥ 25%, and an approval link returned by Amazon.
                </p>
              )}
            </div>
          )}

          {/* Price history (chart + Buy Box rotation strip, same component as the list) */}
          <div className="rounded-2xl overflow-hidden mb-5" style={{ background: "#0A0F1E" }}>
            <div className="px-5 pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>Price history</h2>
            </div>
            <div className="px-5 pb-4">
              <HistoryPanel asin={detail.asin} buyPrice={deal.buyPrice} />
            </div>
          </div>

          {/* Buy Box rotation observations */}
          {recordedBuyBox.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Buy Box rotation — recent observations</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["Observed", "Winner", "Sell $"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...recordedBuyBox].slice(-8).reverse().map((b, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDateTime(b.checkedAt)}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold" style={b.winner === "us" ? { background: "#F0FDF4", color: "#16A34A" } : { background: "#F9FAFB", color: "#6B7280" }}>
                            {b.winner === "us" ? "Us" : "Competitor"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{money(b.sellPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent checks */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Recent checks</h2>
            {detail.recentChecks.length === 0 ? (
              <p className="text-sm text-gray-400">No checks recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["Checked", "Buy $", "Sell $", "Net", "Margin", "Verdict", "Eligibility"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentChecks.map((c, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDateTime(c.checkedAt)}</td>
                        <td className="px-3 py-2 text-gray-600">${c.buyPrice.toFixed(2)}</td>
                        <td className="px-3 py-2 text-gray-600">{money(c.sellPrice)}</td>
                        <td className="px-3 py-2 font-medium" style={{ color: c.netProfit === null ? "#9CA3AF" : c.netProfit >= 0 ? "#16A34A" : "#DC2626" }}>
                          {c.netProfit === null ? "—" : `${c.netProfit >= 0 ? "+" : "−"}$${Math.abs(c.netProfit).toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{c.marginPct === null ? "—" : `${c.marginPct.toFixed(1)}%`}</td>
                        <td className="px-3 py-2"><VerdictBadge verdict={c.verdict} small /></td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{c.eligibility}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/deals" className="inline-block mb-4 text-sm font-semibold hover:underline" style={{ color: "#B8922A" }}>
      ← All deals
    </Link>
  );
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
      <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#9CA3AF" }}>{label}</p>
      {children}
    </div>
  );
}

function VerdictBadge({ verdict, small }: { verdict: "BUY" | "SKIP" | "UNKNOWN"; small?: boolean }) {
  const styles = {
    BUY: { background: "#F0FDF4", color: "#16A34A" },
    SKIP: { background: "#FEF2F2", color: "#DC2626" },
    UNKNOWN: { background: "#F9FAFB", color: "#6B7280" },
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ${small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
      style={styles[verdict]}
    >
      {verdict === "BUY" ? "✓ BUY" : verdict === "SKIP" ? "✕ SKIP" : "? UNKNOWN"}
    </span>
  );
}
