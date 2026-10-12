"use client";

import { useCallback, useEffect, useState } from "react";

type Intent = {
  id: string;
  asin: string;
  qty: number;
  unitPrice: number;
  verdict: string;
  eligibility: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "EXECUTED" | "REJECTED";
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  retailerUrl: string | null;
  checkoutStatus: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  PENDING_APPROVAL: { bg: "#FEF3C7", text: "#92400E" },
  APPROVED: { bg: "#D1FAE5", text: "#065F46" },
  EXECUTED: { bg: "#DBEAFE", text: "#1E40AF" },
  REJECTED: { bg: "#FEE2E2", text: "#991B1B" },
};

const CHECKOUT_LABEL: Record<string, string> = {
  none: "Not started",
  requested: "Queued",
  in_progress: "Preparing cart…",
  awaiting_payment: "Awaiting your payment",
  completed: "Completed",
  failed: "Failed",
};

export default function PurchasesPage() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const fetchIntents = useCallback(async () => {
    try {
      const res = await fetch("/api/purchases");
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { intents: Intent[] };
      setIntents(Array.isArray(data.intents) ? data.intents : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntents();
  }, [fetchIntents]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id + decision);
    try {
      const res = await fetch(`/api/purchases/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await res.json()) as { error?: string; reasons?: string[] };
      if (!res.ok) throw new Error(data.error ?? "failed");
      setNotice(`Intent ${decision === "approve" ? "approved" : "rejected"}.`);
      fetchIntents();
    } catch (e) {
      setNotice(`Could not record decision — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setBusy(null);
    }
  }

  async function requestCheckout(id: string) {
    setBusy(id + "checkout");
    try {
      const res = await fetch(`/api/purchases/${id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = (await res.json()) as { error?: string; warning?: string | null };
      if (!res.ok) throw new Error(data.error ?? "failed");
      setNotice(
        data.warning ??
          "Checkout queued — the browser will prepare your cart and stop at payment. You'll confirm the payment yourself."
      );
      fetchIntents();
    } catch (e) {
      setNotice(`Could not queue checkout — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0D1B2A" }}>Purchase Intents</h1>
          <p className="text-sm text-gray-500 mt-1">
            Nothing is purchased here — every intent needs your approval, and assisted checkout always stops at payment.
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchIntents(); }}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold border transition hover:bg-gray-50"
          style={{ color: "#0D1B2A", borderColor: "#E5E7EB" }}
        >
          ↻ Refresh
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>
      )}
      {loadError && !loading && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load intents — the server didn't respond.
          <button onClick={() => { setLoading(true); fetchIntents(); }} className="ml-3 font-semibold underline">Retry</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading intents…</div>
        ) : intents.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No purchase intents yet. Create one from a BUY deal on the Deals page.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-5 py-3">ASIN</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3">Unit $</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Checkout</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {intents.map((it) => {
                  const st = STATUS_STYLE[it.status] ?? STATUS_STYLE.PENDING_APPROVAL;
                  const co = it.checkoutStatus ?? "none";
                  const canCheckout = it.status === "APPROVED" && (co === "none" || co === "failed");
                  return (
                    <tr key={it.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-5 py-3 font-mono font-semibold" style={{ color: "#0D1B2A" }}>
                        {it.asin}
                        {it.retailerUrl && (
                          <a
                            href={it.retailerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs font-normal text-[#B8922A] underline mt-0.5"
                          >
                            retailer link ↗
                          </a>
                        )}
                      </td>
                      <td className="px-5 py-3">{it.qty}</td>
                      <td className="px-5 py-3">${Number(it.unitPrice).toFixed(2)}</td>
                      <td className="px-5 py-3">
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: st.bg, color: st.text }}>
                          {it.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500">{CHECKOUT_LABEL[co] ?? co}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {new Date(it.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                          {it.status === "PENDING_APPROVAL" && (
                            <>
                              <button
                                disabled={busy === it.id + "approve"}
                                onClick={() => decide(it.id, "approve")}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition disabled:opacity-50"
                                style={{ background: "#B8922A" }}
                              >
                                Approve
                              </button>
                              <button
                                disabled={busy === it.id + "reject"}
                                onClick={() => decide(it.id, "reject")}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition hover:bg-gray-50 disabled:opacity-50"
                                style={{ color: "#991B1B", borderColor: "#FECACA" }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {canCheckout && (
                            <button
                              disabled={busy === it.id + "checkout"}
                              onClick={() => requestCheckout(it.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50"
                              style={{ color: "#B8922A", border: "1.5px solid #B8922A", background: "transparent" }}
                              title="Queue a browser-assisted checkout. The browser prepares your cart and stops at payment — you confirm the payment yourself."
                            >
                              🛒 Assisted checkout
                            </button>
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
