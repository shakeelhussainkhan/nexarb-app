"use client";

import { useCallback, useEffect, useState } from "react";

type Listing = {
  id: string;
  channel: "amazon" | "walmart";
  sellerSku: string;
  asin: string | null;
  title: string | null;
  ourPrice: number | null;
  buyboxPrice: number | null;
  buyboxState: "winning" | "losing" | "unknown";
  offerCount: number | null;
  lastSyncedAt: string | null;
  buyCost: number | null;
  netProfit: number | null;
  marginPct: number | null;
  suggested: number | null;
  suggestedReason: string | null;
  priceMin: number | null;
  priceMax: number | null;
};

const BUYBOX_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  winning: { bg: "#D1FAE5", text: "#065F46", label: "Winning" },
  losing: { bg: "#FEE2E2", text: "#991B1B", label: "Losing" },
  unknown: { bg: "#F3F4F6", text: "#6B7280", label: "Unknown" },
};

function fmt(n: number | null, prefix = "$"): string {
  return n == null ? "—" : `${prefix}${n.toFixed(2)}`;
}

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncSummary, setSyncSummary] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchListings = useCallback(async () => {
    try {
      const res = await fetch("/api/listings");
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { listings: Listing[] };
      setListings(Array.isArray(data.listings) ? data.listings : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  async function sync() {
    setSyncBusy(true);
    setSyncSummary("");
    try {
      const res = await fetch("/api/listings/sync", { method: "POST" });
      const data = (await res.json()) as {
        synced?: { amazon?: number; walmart?: number };
        errors?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "sync failed");
      const s = data.synced ?? {};
      const parts = [`Amazon: ${s.amazon ?? 0}`, `Walmart: ${s.walmart ?? 0}`];
      setSyncSummary(`Synced — ${parts.join(" · ")}.`);
      if (data.errors?.length) {
        setSyncSummary((prev) => `${prev} ${data.errors!.length} note(s): ${data.errors![0]}`);
      }
      fetchListings();
    } catch (e) {
      setNotice(`Sync failed — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setSyncBusy(false);
    }
  }

  async function reprice(l: Listing) {
    if (l.suggested == null) return;
    setBusy(l.id);
    setConfirming(null);
    try {
      const res = await fetch(`/api/listings/${l.id}/reprice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: l.suggested }),
      });
      const data = (await res.json()) as { error?: string; reasons?: string[]; newPrice?: number };
      if (!res.ok) throw new Error(data.reasons?.[0] ?? data.error ?? "reprice failed");
      setNotice(`Price set to $${Number(data.newPrice).toFixed(2)} on ${l.channel === "amazon" ? "Amazon" : "Walmart"} (${l.sellerSku}).`);
      fetchListings();
    } catch (e) {
      setNotice(`Could not change the price — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0D1B2A" }}>Listings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Your live Amazon &amp; Walmart listings — our price vs the Buy Box, margin, and one-tap repricing within your bounds.
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncBusy}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: "#B8922A" }}
        >
          {syncBusy ? "Syncing…" : "↻ Sync listings"}
        </button>
      </div>

      {syncSummary && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{syncSummary}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
      )}
      {loadError && !loading && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load listings — the server didn&apos;t respond.
          <button onClick={() => { setLoading(true); fetchListings(); }} className="ml-3 font-semibold underline">Retry</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading listings…</div>
        ) : listings.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-400 mb-4">No listings synced yet. Pull your live Amazon &amp; Walmart listings to see them here.</p>
            <button
              onClick={sync}
              disabled={syncBusy}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
              style={{ background: "#B8922A" }}
            >
              {syncBusy ? "Syncing…" : "↻ Sync listings now"}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3">Our price</th>
                  <th className="px-5 py-3">Buy Box</th>
                  <th className="px-5 py-3">Box</th>
                  <th className="px-5 py-3">Offers</th>
                  <th className="px-5 py-3">Margin</th>
                  <th className="px-5 py-3">Suggested</th>
                  <th className="px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const bb = BUYBOX_STYLE[l.buyboxState];
                  const isConfirming = confirming === l.id;
                  return (
                    <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-5 py-3 max-w-xs">
                        <div className="font-semibold truncate" style={{ color: "#0D1B2A" }} title={l.title ?? ""}>
                          {l.title ?? "Untitled listing"}
                        </div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5">
                          {l.asin ?? l.sellerSku}
                          <span className="ml-2 text-gray-300">SKU {l.sellerSku}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="px-2.5 py-1 rounded-full text-xs font-semibold"
                          style={l.channel === "amazon"
                            ? { background: "#FEF3C7", color: "#92400E" }
                            : { background: "#DBEAFE", color: "#1E40AF" }}
                        >
                          {l.channel === "amazon" ? "Amazon" : "Walmart"}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-semibold" style={{ color: "#0D1B2A" }}>{fmt(l.ourPrice)}</td>
                      <td className="px-5 py-3">{fmt(l.buyboxPrice)}</td>
                      <td className="px-5 py-3">
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: bb.bg, color: bb.text }}>
                          {bb.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">{l.offerCount ?? "—"}</td>
                      <td className="px-5 py-3">
                        {l.netProfit == null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span style={{ color: l.netProfit >= 0 ? "#065F46" : "#991B1B" }} className="font-semibold">
                            {fmt(l.netProfit)} <span className="text-xs font-normal">({l.marginPct != null ? (l.marginPct * 100).toFixed(1) : "?"}%)</span>
                          </span>
                        )}
                        {l.buyCost == null && l.ourPrice != null && (
                          <div className="text-[11px] text-gray-400">no buy cost on record</div>
                        )}
                      </td>
                      <td className="px-5 py-3" title={l.suggestedReason ?? ""}>
                        {l.suggested == null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="font-semibold" style={{ color: "#0D1B2A" }}>
                            {fmt(l.suggested)}
                            {(l.priceMin != null || l.priceMax != null) && (
                              <span className="block text-[11px] font-normal text-gray-400">
                                bounds {l.priceMin != null ? fmt(l.priceMin) : "—"}–{l.priceMax != null ? fmt(l.priceMax) : "—"}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {l.suggested != null && l.suggested !== l.ourPrice && (
                          isConfirming ? (
                            <div className="flex gap-2 items-center">
                              <button
                                disabled={busy === l.id}
                                onClick={() => reprice(l)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition disabled:opacity-50"
                                style={{ background: "#B8922A" }}
                              >
                                {busy === l.id ? "Setting…" : `Set ${fmt(l.suggested)}?`}
                              </button>
                              <button
                                disabled={busy === l.id}
                                onClick={() => setConfirming(null)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition hover:bg-gray-50 disabled:opacity-50"
                                style={{ color: "#6B7280", borderColor: "#E5E7EB" }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setNotice(""); setConfirming(l.id); }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                              style={{ color: "#B8922A", border: "1.5px solid #B8922A", background: "transparent" }}
                              title="Apply the suggested price to the live listing. You confirm before anything changes."
                            >
                              Apply
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {listings.length > 0 && (
        <p className="text-xs text-gray-400 mt-4">
          Margin uses the fee-stack estimate and your latest recorded buy cost. Price changes write to the live
          marketplace and are logged. Bounds shown come from your watchlist — prices outside them are refused.
        </p>
      )}
    </div>
  );
}
