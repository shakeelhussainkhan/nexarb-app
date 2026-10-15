"use client";

import { useCallback, useEffect, useState } from "react";

type Screening = { verdict: "clear" | "review" | "blocked"; category: string; reasons: string[] };

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
  screening?: Screening;
};

type Order = {
  id: string;
  ref: string;
  title: string;
  imageUrl: string | null;
  detailUrl: string | null;
  supplierName: string | null;
  targetAsin: string | null;
  expectedSellPrice: number | null;
  qty: number;
  landedPerUnit: number;
  orderTotal: number;
  screeningVerdict: string;
  screeningReasons: string[];
  status: string;
  purchaseIntentId: string | null;
  intentStatus: string | null;
  alibabaOrderId: string | null;
  payUrl: string | null;
  lastSync: { at: string; stage: string; ok: boolean; detail: string } | null;
  eligibilityWarning: string | null;
  shipmentId: string | null;
  createdAt: string;
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

const ORDER_STATUS_STYLE: Record<string, { background: string; color: string }> = {
  draft: { background: "#F3F4F6", color: "#374151" },
  pending_approval: { background: "#FEF3C7", color: "#92400E" },
  approved: { background: "#DBEAFE", color: "#1E40AF" },
  ready_to_place: { background: "#E0E7FF", color: "#3730A3" },
  awaiting_payment: { background: "#FFEDD5", color: "#9A3412" },
  placed: { background: "#D1FAE5", color: "#065F46" },
  shipped: { background: "#D1FAE5", color: "#065F46" },
  delivered: { background: "#D1FAE5", color: "#065F46" },
  failed: { background: "#FEE2E2", color: "#991B1B" },
  cancelled: { background: "#F3F4F6", color: "#6B7280" },
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Clock time of the last recorded sync attempt (order.lastSync, built
 * server-side by ordersCore buildSyncAttempt) — the full timestamp and
 * failure detail live in the order's alibaba_status_raw. */
function syncClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function screeningChip(v: string) {
  if (v === "blocked")
    return <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "#FEE2E2", color: "#991B1B" }}>Blocked</span>;
  if (v === "review")
    return <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "#FEF3C7", color: "#92400E" }}>Review</span>;
  return <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "#D1FAE5", color: "#065F46" }}>Clear</span>;
}

export default function AlibabaPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [keyword, setKeyword] = useState("");
  const [asin, setAsin] = useState("");
  const [qty, setQty] = useState("10");
  const [sellPrice, setSellPrice] = useState("");
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [searching, setSearching] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLive, setOrdersLive] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/alibaba/status");
      const data = (await res.json()) as Status & { success: boolean };
      setStatus({ configured: data.configured, connected: data.connected, account: data.account, expiresAt: data.expiresAt });
    } catch {
      setStatus({ configured: false, connected: false, account: null, expiresAt: null });
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/alibaba/orders");
      const data = (await res.json()) as { success: boolean; orders?: Order[]; ordersLive?: boolean };
      if (data.success) {
        setOrders(data.orders ?? []);
        setOrdersLive(Boolean(data.ordersLive));
      }
    } catch {
      // Orders section just stays empty — the page's main job is sourcing.
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchOrders();
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
  }, [fetchStatus, fetchOrders]);

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

  async function draftOrder(offer: Offer) {
    setDraftingId(offer.productId);
    try {
      const res = await fetch("/api/alibaba/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: offer.productId,
          qty: offer.orderQty,
          asin: asin.trim() || undefined,
          sellPrice: Number(sellPrice) > 0 ? Number(sellPrice) : undefined,
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string; order?: Order };
      if (!res.ok || !data.success || !data.order) throw new Error(data.error ?? "draft failed");
      setNotice(
        `Draft order ${data.order.ref} created — ${data.order.qty} × ${money(data.order.landedPerUnit)} landed = ${money(data.order.orderTotal)}. ` +
          `It spends nothing until it becomes a purchase intent and you approve that intent.`
      );
      await fetchOrders();
    } catch (e) {
      setNotice(`Draft failed — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setDraftingId(null);
    }
  }

  async function orderAction(order: Order, action: "intent" | "place") {
    setBusyOrderId(order.id);
    try {
      const res = await fetch(`/api/alibaba/orders/${order.id}/${action}`, { method: "POST" });
      const data = (await res.json()) as {
        success: boolean;
        error?: string;
        reasons?: string[];
        note?: string;
        placed?: boolean;
        warnings?: string[];
      };
      if (!res.ok || !data.success) {
        const detail = data.reasons && data.reasons.length > 0 ? ` ${data.reasons.join(" ")}` : "";
        throw new Error(`${data.error ?? "action failed"}.${detail}`);
      }
      const warningNote =
        data.warnings && data.warnings.length > 0 ? ` ⚠ ${data.warnings.join(" ")}` : "";
      setNotice(
        action === "intent"
          ? `Purchase intent created for ${order.ref} — approve or reject it on the Purchases page. Nothing is ordered before that approval.${warningNote}`
          : data.note ?? `Order ${order.ref} placed.`
      );
      await fetchOrders();
    } catch (e) {
      setNotice(`${action === "intent" ? "Intent" : "Placement"} failed — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setBusyOrderId(null);
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
          verify it before anything can become a deal. Drafting an order spends nothing: a draft can
          only move forward as a purchase intent, and nothing is ordered without your approval of
          that intent.
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
        <input
          value={sellPrice}
          onChange={(e) => setSellPrice(e.target.value)}
          inputMode="decimal"
          placeholder="Expected Amazon sell $ (for drafts)"
          className="w-56 px-3 py-2 rounded-lg border border-gray-300 text-sm"
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
        <div className="overflow-x-auto mb-12">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-4">Product</th>
                <th className="pb-2 pr-4">Supplier</th>
                <th className="pb-2 pr-4">Compliance</th>
                <th className="pb-2 pr-4">MOQ</th>
                <th className="pb-2 pr-4">Unit $</th>
                <th className="pb-2 pr-4">Ship / unit</th>
                <th className="pb-2 pr-4">Landed / unit</th>
                <th className="pb-2 pr-4">Link</th>
                <th className="pb-2">Order</th>
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
                  <td className="py-3 pr-4">{o.screening ? screeningChip(o.screening.verdict) : "—"}</td>
                  <td className="py-3 pr-4 text-sm">{o.moq}</td>
                  <td className="py-3 pr-4 text-sm">{money(o.unitPrice)}</td>
                  <td className="py-3 pr-4 text-sm">{money(o.shippingPerUnit)}</td>
                  <td className="py-3 pr-4 text-sm font-medium" style={{ color: "#065F46" }}>
                    {money(o.landedPerUnit)}
                  </td>
                  <td className="py-3 pr-4">
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
                  <td className="py-3">
                    <button
                      onClick={() => draftOrder(o)}
                      disabled={draftingId === o.productId}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                      style={{ background: "#0D1B2A", color: "#fff" }}
                    >
                      {draftingId === o.productId ? "Drafting…" : "Draft order"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4">
        <h2 className="text-lg font-bold mb-1" style={{ color: "#0D1B2A" }}>
          Orders
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Draft → purchase intent (Purchases page approval) → place. The guardrail caps apply to the
          intent exactly as for any other purchase.
          {" "}
          Placing an approved order creates a real Alibaba Trade Assurance order — you then
          pay for it at Alibaba&rsquo;s cashier; NexArb itself never charges the order.
        </p>
        {orders.length === 0 ? (
          <div className="text-sm text-gray-500">No Alibaba orders yet. Draft one from a search result above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-4">Ref</th>
                  <th className="pb-2 pr-4">Product</th>
                  <th className="pb-2 pr-4">Compliance</th>
                  <th className="pb-2 pr-4">Qty</th>
                  <th className="pb-2 pr-4">Landed total</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Intent</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const chip = ORDER_STATUS_STYLE[o.status] ?? ORDER_STATUS_STYLE.draft;
                  return (
                    <tr key={o.id} className="border-t border-gray-100 align-top">
                      <td className="py-3 pr-4 text-sm font-medium" style={{ color: "#0D1B2A" }}>
                        {o.ref}
                        {o.alibabaOrderId && (
                          <div className="text-xs text-gray-500">Alibaba #{o.alibabaOrderId}</div>
                        )}
                        {o.shipmentId && <div className="text-xs text-gray-500">Shipment + checklist created</div>}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-sm" style={{ color: "#0D1B2A" }}>
                          {o.title}
                        </div>
                        <div className="text-xs text-gray-500">
                          {o.supplierName ?? "—"}
                          {o.targetAsin ? ` · ASIN ${o.targetAsin}` : ""}
                          {o.expectedSellPrice ? ` · sell ${money(o.expectedSellPrice)}` : ""}
                        </div>
                      </td>
                      <td className="py-3 pr-4">{screeningChip(o.screeningVerdict)}</td>
                      <td className="py-3 pr-4 text-sm">{o.qty}</td>
                      <td className="py-3 pr-4 text-sm font-medium" style={{ color: "#065F46" }}>
                        {money(o.orderTotal)}
                        <div className="text-xs text-gray-500 font-normal">{money(o.landedPerUnit)} / unit</div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={chip}>
                          {o.status.replace(/_/g, " ")}
                        </span>
                        {o.lastSync ? (
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            sync {o.lastSync.stage} · {o.lastSync.ok ? "ok" : "failed"} · {syncClock(o.lastSync.at)}
                          </div>
                        ) : null}
                        {o.eligibilityWarning ? (
                          <div className="text-[11px] mt-0.5 max-w-[260px]" style={{ color: "#92400E" }} title={o.eligibilityWarning}>
                            ⚠ eligibility warning — benchmark brand-blocked; own-brand listing (see intent)
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 text-sm">{o.intentStatus ?? (o.purchaseIntentId ? "—" : "none")}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {o.status === "draft" && (
                            <button
                              onClick={() => orderAction(o, "intent")}
                              disabled={busyOrderId === o.id}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                              style={{ background: "#D4AF37", color: "#0D1B2A" }}
                            >
                              {busyOrderId === o.id ? "Working…" : "Create intent"}
                            </button>
                          )}
                          {(o.status === "approved" || o.status === "ready_to_place" || (o.status === "failed" && !o.alibabaOrderId)) && (
                            <button
                              onClick={() => orderAction(o, "place")}
                              disabled={busyOrderId === o.id || o.intentStatus !== "APPROVED"}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                              style={{ background: "#0D1B2A" }}
                            >
                              {busyOrderId === o.id
                                ? "Working…"
                                : o.status === "failed"
                                  ? "Retry placement"
                                  : o.status === "ready_to_place" && !ordersLive
                                    ? "Re-check"
                                    : "Place order"}
                            </button>
                          )}
                          {o.status === "awaiting_payment" && o.payUrl && (
                            <a
                              href={o.payUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                              style={{ background: "#D4AF37", color: "#0D1B2A" }}
                            >
                              Pay on Alibaba
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
