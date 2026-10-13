"use client";

import { useCallback, useEffect, useState } from "react";

type Offer = {
  productId: string;
  title: string;
  image: string | null;
  supplier: string | null;
  moq: number;
  orderQty: number;
  unitPrice: number;
  shippingPerUnit: number;
  landedPerUnit: number;
  detailUrl: string | null;
};

type Status = { configured: boolean; connected: boolean; account: string | null; expiresAt: string | null };

const FLAG_NOTICES: Record<string, string> = {
  connected: "Alibaba connected — your buyer account is linked and searches will run against it.",
  "session-missing": "The connection came back without your dashboard session. Open this page signed in and click Connect again.",
  "no-code": "Alibaba didn't return an authorization code — try connecting again.",
  "bad-state": "The connection check failed (stale or mismatched state). Try connecting again.",
  "not-configured": "The server isn't configured for Alibaba yet (app key/secret missing).",
  "exchange-failed": "Alibaba rejected the authorization exchange. Try connecting again.",
  "save-failed": "Connected to Alibaba but saving the token failed. Try again.",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function AlibabaPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [keyword, setKeyword] = useState("");
  const [asin, setAsin] = useState("");
  const [qty, setQty] = useState("10");
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [searching, setSearching] = useState(false);
  const [tracking, setTracking] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/alibaba/status");
      const data = (await res.json()) as Status & { success: boolean };
      setStatus({ configured: data.configured, connected: data.connected, account: data.account, expiresAt: data.expiresAt });
    } catch {
      setStatus({ configured: false, connected: false, account: null, expiresAt: null });
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("alibaba");
    if (flag && FLAG_NOTICES[flag]) {
      const detail = params.get("detail");
      setNotice(
        flag === "exchange-failed" && detail
          ? `${FLAG_NOTICES[flag]} Alibaba said: ${detail}`
          : FLAG_NOTICES[flag]
      );
    }
  }, [fetchStatus]);

  async function runSearch(addBest: boolean) {
    if (!keyword.trim()) {
      setNotice("Enter a product keyword to search Alibaba.");
      return;
    }
    if (addBest) setTracking(true);
    else setSearching(true);
    try {
      const res = await fetch("/api/sourcing/alibaba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          asin: asin.trim() || undefined,
          qty: Number(qty) || 10,
          size: 5,
          addBestToWatchlist: addBest,
        }),
      });
      const data = (await res.json()) as {
        success: boolean;
        error?: string;
        offers?: Offer[];
        notes?: string[];
        added?: boolean;
        alreadyTracked?: boolean;
      };
      if (!res.ok || !data.success) throw new Error(data.error ?? "search failed");
      setOffers(data.offers ?? []);
      setNotes(data.notes ?? []);
      if (addBest) {
        setNotice(
          data.added
            ? `Tracking the cheapest offer as the buy price for ${asin.trim().toUpperCase()} — scans will now verify it against live Amazon prices.`
            : data.alreadyTracked
              ? `${asin.trim().toUpperCase()} is already on the watchlist — its buy price was left unchanged.`
              : "Nothing was added — no priced offers came back."
        );
      } else {
        setNotice(
          (data.offers ?? []).length === 0
            ? "No priced offers found for that keyword. Try broader terms."
            : `Found ${data.offers?.length} priced offer(s), cheapest landed cost first.`
        );
      }
    } catch (e) {
      setNotice(`Search failed — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setSearching(false);
      setTracking(false);
    }
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0D1B2A" }}>
          Alibaba Sourcing
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Search Alibaba with your connected buyer account. Prices shown are landed costs per unit —
          the MOQ-aware ladder price plus shipping — so they can be compared honestly against Amazon
          sell prices. Tracking an offer puts it on the watchlist as a buy price, and the normal scans
          verify it before anything can become a deal. Nothing is ordered here.
        </p>
      </div>

      {notice && (
        <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: "#FFFBEB", color: "#92400E" }}>
          {notice}
        </div>
      )}

      <div className="mb-8 px-4 py-3 rounded-lg border border-gray-200 flex flex-wrap items-center gap-3">
        {status === null ? (
          <span className="text-sm text-gray-500">Checking connection…</span>
        ) : !status.configured ? (
          <span className="text-sm" style={{ color: "#991B1B" }}>
            Server not configured — the Alibaba app key/secret are not set yet.
          </span>
        ) : status.connected ? (
          <span className="text-sm" style={{ color: "#065F46" }}>
            ● Connected{status.account ? ` as ${status.account}` : ""}. Tokens refresh automatically.
          </span>
        ) : (
          <>
            <span className="text-sm text-gray-600">Not connected yet.</span>
            <a
              href="/api/alibaba/connect"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "#D4AF37", color: "#0D1B2A" }}
            >
              Connect Alibaba account
            </a>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Product keyword, e.g. silicone spatula set"
          className="flex-1 min-w-56 px-3 py-2 rounded-lg border border-gray-300 text-sm"
        />
        <input
          value={asin}
          onChange={(e) => setAsin(e.target.value)}
          placeholder="Amazon ASIN (optional)"
          className="w-48 px-3 py-2 rounded-lg border border-gray-300 text-sm"
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="numeric"
          placeholder="Qty"
          className="w-24 px-3 py-2 rounded-lg border border-gray-300 text-sm"
        />
        <button
          onClick={() => runSearch(false)}
          disabled={searching || tracking}
          className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ background: "#0D1B2A" }}
        >
          {searching ? "Searching…" : "Search Alibaba"}
        </button>
        {asin.trim() && offers !== null && offers.length > 0 && (
          <button
            onClick={() => runSearch(true)}
            disabled={searching || tracking}
            className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: "#D4AF37", color: "#0D1B2A" }}
          >
            {tracking ? "Adding…" : `Track cheapest for ${asin.trim().toUpperCase()}`}
          </button>
        )}
      </div>

      {notes.length > 0 && (
        <div className="mb-4 text-xs text-gray-500">
          {notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {offers !== null && offers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-4">Product</th>
                <th className="pb-2 pr-4">Supplier</th>
                <th className="pb-2 pr-4">MOQ</th>
                <th className="pb-2 pr-4">Unit $</th>
                <th className="pb-2 pr-4">Ship / unit</th>
                <th className="pb-2 pr-4">Landed / unit</th>
                <th className="pb-2">Link</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.productId} className="border-t border-gray-100 align-top">
                  <td className="py-3 pr-4">
                    <div className="flex items-start gap-3">
                      {o.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.image} alt="" className="w-10 h-10 object-cover rounded" />
                      )}
                      <div>
                        <div className="font-medium text-sm" style={{ color: "#0D1B2A" }}>
                          {o.title}
                        </div>
                        <div className="text-xs text-gray-500">Order qty {o.orderQty}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-sm">{o.supplier ?? "—"}</td>
                  <td className="py-3 pr-4 text-sm">{o.moq}</td>
                  <td className="py-3 pr-4 text-sm">{money(o.unitPrice)}</td>
                  <td className="py-3 pr-4 text-sm">{money(o.shippingPerUnit)}</td>
                  <td className="py-3 pr-4 text-sm font-medium" style={{ color: "#065F46" }}>
                    {money(o.landedPerUnit)}
                  </td>
                  <td className="py-3">
                    {o.detailUrl && (
                      <a
                        href={o.detailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium underline"
                      >
                        View
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
