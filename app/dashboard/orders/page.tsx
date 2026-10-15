"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PIPELINE_STAGES,
  type CanonicalStage,
  type OrderJourney,
} from "@/lib/lifecycle/core";

// Orders — the visual order-lifecycle view (PR-D2) over the PR-D1
// journeys API (GET /api/orders/journeys, lib/lifecycle/core.ts).
//
// BOARD: one column per canonical pipeline stage; a journey sits in
// the column of its currentStage. JOURNEY DETAIL: a stepper of every
// pipeline stage — a stage is filled ONLY when a source record
// evidences it (the core's no-invented-stages rule); unreached stages
// render greyed and are never back-filled by this page. The "awaiting
// <feed>" hints under a few greyed stages name the exact feed the D1
// mapping table records as missing (warehouse prep / listing link /
// returns) — stages without a documented gap get no hint.
//
// This page reads and registers; it never invents data. External
// (portal) orders enter through the registration form below, which
// posts to POST /api/orders/external (session-only).

const STAGE_LABEL: Record<CanonicalStage, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  placed: "Placed",
  paid: "Paid",
  shipped: "Shipped",
  at_warehouse: "At warehouse",
  prepped: "Prepped",
  to_amazon: "To Amazon",
  listed: "Listed",
  selling: "Selling",
  returned: "Returned",
  cancelled: "Cancelled",
  failed: "Failed",
  problem: "Problem",
};

const KIND_LABEL: Record<OrderJourney["kind"], string> = {
  alibaba: "Alibaba",
  retail: "Retail",
  external: "Distributor",
};

const KIND_STYLE: Record<OrderJourney["kind"], { background: string; color: string }> = {
  alibaba: { background: "#FFEDD5", color: "#9A3412" },
  retail: { background: "#DBEAFE", color: "#1E40AF" },
  external: { background: "#EDE9FE", color: "#5B21B6" },
};

/** Documented feed gaps from the D1 mapping table in
 * lib/lifecycle/core.ts — the ONLY stages that get an "awaiting"
 * hint. Everything else unreached is simply greyed. */
const AWAITING_FEED: Partial<Record<CanonicalStage, string>> = {
  prepped: "awaiting warehouse prep feed",
  to_amazon: "awaiting warehouse shipment feed",
  listed: "awaiting listing ↔ order link",
  returned: "awaiting returns feed",
};

const EXCEPTION_CURRENT: ReadonlySet<CanonicalStage> = new Set([
  "returned",
  "cancelled",
  "failed",
  "problem",
]);

/** Pinned to "Needs attention" when the journey carries recorded
 * exceptions or sits in an exception state (brief's rule; a plain
 * external/alibaba cancellation lands here via its currentStage). */
function needsAttention(j: OrderJourney): boolean {
  return j.exceptions.length > 0 || EXCEPTION_CURRENT.has(j.currentStage);
}

function money(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(2)}`;
}

function fmtAt(iso: string | null): string {
  if (!iso) return "no timestamp recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "no timestamp recorded";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dwellText(j: OrderJourney): string {
  if (j.dwellDays === null) return "time in stage unknown";
  return j.dwellDays === 0 ? "in this stage today" : `in this stage ${j.dwellDays}d`;
}

export default function OrdersPage() {
  const [journeys, setJourneys] = useState<OrderJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | OrderJourney["kind"]>("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchJourneys = useCallback(async () => {
    try {
      const res = await fetch("/api/orders/journeys");
      const data = (await res.json()) as { journeys?: OrderJourney[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Journeys request failed (${res.status})`);
      setJourneys(Array.isArray(data.journeys) ? data.journeys : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load order journeys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJourneys();
  }, [fetchJourneys]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return journeys.filter((j) => {
      if (kind !== "all" && j.kind !== kind) return false;
      if (!needle) return true;
      return (
        j.title.toLowerCase().includes(needle) ||
        j.ref.toLowerCase().includes(needle) ||
        (j.asin ?? "").toLowerCase().includes(needle) ||
        j.supplierOrRetailer.toLowerCase().includes(needle)
      );
    });
  }, [journeys, kind, q]);

  const attention = useMemo(() => filtered.filter(needsAttention), [filtered]);
  const attentionIds = useMemo(() => new Set(attention.map((j) => j.id)), [attention]);
  const byStage = useMemo(() => {
    const map = new Map<CanonicalStage, OrderJourney[]>();
    for (const stage of PIPELINE_STAGES) map.set(stage, []);
    for (const j of filtered) {
      if (attentionIds.has(j.id)) continue;
      map.get(j.currentStage)?.push(j);
    }
    return map;
  }, [filtered, attentionIds]);

  const selected = useMemo(
    () => filtered.find((j) => j.id === selectedId) ?? null,
    [filtered, selectedId]
  );

  const card = (j: OrderJourney, attentionCard = false) => (
    <button
      key={j.id}
      onClick={() => setSelectedId(j.id === selectedId ? null : j.id)}
      className="w-full text-left rounded-xl border bg-white p-3 transition-shadow hover:shadow-md"
      style={{
        borderColor: selectedId === j.id ? "#B8922A" : attentionCard ? "#FECACA" : "#E5E7EB",
        boxShadow: selectedId === j.id ? "0 0 0 1px #B8922A" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug" style={{ color: "#0D1B2A" }}>
          {j.title}
        </p>
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
          style={KIND_STYLE[j.kind]}
        >
          {KIND_LABEL[j.kind]}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {j.ref} · {j.supplierOrRetailer}
      </p>
      <p className="text-xs text-gray-600 mt-1">
        {j.qty !== null ? `${j.qty} units · ` : ""}
        {money(j.amount)}
        {j.asin ? ` · ${j.asin}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className="text-[11px] text-gray-500">{dwellText(j)}</span>
        {j.stale && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: "#FEF3C7", color: "#92400E" }}
            title="This order has sat in its current stage longer than the lifecycle threshold for that stage."
          >
            Stale
          </span>
        )}
        {attentionCard && j.exceptions.length > 0 && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: "#FEE2E2", color: "#991B1B" }}
          >
            {j.exceptions.length} exception{j.exceptions.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );

  return (
    <div className="p-6 lg:p-10 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0D1B2A" }}>
          Orders
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Every order in one pipeline — Alibaba imports, approved retail purchases, and distributor
          orders placed outside the app (registered below). A stage is shown as reached only when a
          source record proves it; stages with no feed yet (prep, Amazon inbound, listing, returns)
          stay grey rather than being guessed. Orders with recorded exceptions or an exception
          status are pinned to <strong>Needs attention</strong> at the top. Click any card for its
          full journey.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white"
          >
            <option value="all">All</option>
            <option value="alibaba">Alibaba</option>
            <option value="retail">Retail</option>
            <option value="external">Distributor</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, ref, supplier, ASIN"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 w-64"
          />
        </label>
        <button
          onClick={fetchJourneys}
          className="text-sm font-semibold px-4 py-2 rounded-lg mb-0.5"
          style={{ background: "#D4AF37", color: "#0D1B2A" }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading orders…</p>
      ) : loadError ? (
        <p className="text-sm" style={{ color: "#991B1B" }}>
          Couldn&apos;t load orders: {loadError}
        </p>
      ) : journeys.length === 0 ? (
        <p className="text-sm text-gray-500">
          No orders yet — orders appear here when an Alibaba draft, an approved purchase, or a
          registered external order exists.
        </p>
      ) : (
        <>
          {attention.length > 0 && (
            <div
              className="rounded-xl border p-4 mb-6"
              style={{ borderColor: "#FECACA", background: "#FEF2F2" }}
            >
              <h2 className="text-sm font-bold mb-3" style={{ color: "#991B1B" }}>
                Needs attention ({attention.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {attention.map((j) => card(j, true))}
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500">No orders match these filters.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-4">
              {PIPELINE_STAGES.map((stage) => {
                const col = byStage.get(stage) ?? [];
                return (
                  <div key={stage} className="w-60 shrink-0">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <h3
                        className="text-xs font-bold uppercase tracking-wide"
                        style={{ color: "#0D1B2A" }}
                      >
                        {STAGE_LABEL[stage]}
                      </h3>
                      <span className="text-xs text-gray-400">{col.length}</span>
                    </div>
                    <div className="space-y-3">
                      {col.length === 0 ? (
                        <p className="text-xs text-gray-400 px-1">No orders</p>
                      ) : (
                        col.map((j) => card(j))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selected && <JourneyDetail journey={selected} onClose={() => setSelectedId(null)} />}
        </>
      )}

      <RegisterExternalOrder onRegistered={fetchJourneys} />
    </div>
  );
}

function JourneyDetail({ journey: j, onClose }: { journey: OrderJourney; onClose: () => void }) {
  const reached = new Map(j.stages.map((s) => [s.stage, s]));
  const exceptionEntries = j.stages.filter((s) => EXCEPTION_CURRENT.has(s.stage));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 mt-2">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold" style={{ color: "#0D1B2A" }}>
            {j.title}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {j.ref} · {j.supplierOrRetailer} · {KIND_LABEL[j.kind]}
            {j.asin ? (
              <>
                {" · "}
                <Link
                  href={`/dashboard/deals/${j.asin}`}
                  className="underline decoration-dotted"
                  style={{ color: "#1E40AF" }}
                >
                  {j.asin}
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            {j.qty !== null ? `Qty ${j.qty} · ` : ""}Order value {money(j.amount)} · Currently:{" "}
            <strong>{STAGE_LABEL[j.currentStage]}</strong> ({dwellText(j)}
            {j.stale ? ", stale" : ""})
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600"
        >
          Close
        </button>
      </div>

      {/* Stepper: every pipeline stage in canonical order. Filled =
          evidenced by a source record; greyed = not reached (no stage
          is ever inferred). */}
      <div className="flex overflow-x-auto pb-2">
        {PIPELINE_STAGES.map((stage, i) => {
          const entry = reached.get(stage);
          const isCurrent = j.currentStage === stage;
          return (
            <div key={stage} className="flex items-start shrink-0">
              {i > 0 && (
                <div
                  className="h-0.5 w-6 mt-[13px]"
                  style={{ background: entry ? "#065F46" : "#E5E7EB" }}
                />
              )}
              <div className="w-32">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={
                    entry
                      ? { background: "#065F46", color: "#FFFFFF" }
                      : { background: "#F3F4F6", color: "#9CA3AF" }
                  }
                  title={entry?.detail ?? undefined}
                >
                  {entry ? "✓" : i + 1}
                </div>
                <p
                  className="text-xs font-semibold mt-1.5"
                  style={{ color: entry ? "#0D1B2A" : "#9CA3AF" }}
                >
                  {STAGE_LABEL[stage]}
                  {isCurrent ? " · now" : ""}
                </p>
                {entry ? (
                  <p className="text-[11px] text-gray-500 leading-snug">
                    {fmtAt(entry.at)}
                    <br />
                    via {entry.source}
                  </p>
                ) : AWAITING_FEED[stage] ? (
                  <p className="text-[11px] text-gray-400 leading-snug">{AWAITING_FEED[stage]}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reached-stage details (hover text lives on the stepper dots;
          the same detail is printed here so nothing hides behind a
          tooltip). */}
      {j.stages.some((s) => s.detail) && (
        <div className="mt-3 space-y-1">
          {j.stages
            .filter((s) => s.detail)
            .map((s) => (
              <p key={s.stage} className="text-xs text-gray-500">
                <strong style={{ color: "#374151" }}>{STAGE_LABEL[s.stage]}:</strong> {s.detail}{" "}
                <span className="text-gray-400">(via {s.source})</span>
              </p>
            ))}
        </div>
      )}

      {(j.exceptions.length > 0 || exceptionEntries.length > 0) && (
        <div
          className="mt-4 rounded-lg border p-3"
          style={{ borderColor: "#FECACA", background: "#FEF2F2" }}
        >
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "#991B1B" }}>
            Exceptions
          </p>
          {exceptionEntries.map((s) => (
            <p key={s.stage} className="text-sm" style={{ color: "#991B1B" }}>
              {STAGE_LABEL[s.stage]} — {fmtAt(s.at)} · via {s.source}
              {s.detail ? ` · ${s.detail}` : ""}
            </p>
          ))}
          {j.exceptions.map((x) => (
            <p key={x} className="text-sm" style={{ color: "#991B1B" }}>
              {x}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RegisterExternalOrder({ onRegistered }: { onRegistered: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [supplier, setSupplier] = useState("");
  const [title, setTitle] = useState("");
  const [asin, setAsin] = useState("");
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setMsg(null);
    setError(null);
    if (!ref.trim() || !supplier.trim() || !title.trim()) {
      setError("Ref, supplier, and title are required.");
      return;
    }
    const body: Record<string, unknown> = {
      ref: ref.trim(),
      supplier: supplier.trim(),
      title: title.trim(),
    };
    if (asin.trim()) body.asin = asin.trim().toUpperCase();
    if (qty.trim()) {
      const n = Number(qty);
      if (!Number.isInteger(n) || n <= 0) {
        setError("Qty must be a positive whole number when given.");
        return;
      }
      body.qty = n;
    }
    if (amount.trim()) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n < 0) {
        setError("Amount must be a non-negative number when given.");
        return;
      }
      body.amount = n;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/orders/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        reasons?: string[];
        order?: { ref: string };
      };
      if (!res.ok) {
        // Surface the API's own words verbatim.
        const parts = [data.error ?? `Request failed (${res.status})`, ...(data.reasons ?? [])];
        setError(parts.join(" "));
        return;
      }
      setMsg(`Registered external order ${data.order?.ref ?? body.ref} — it starts at Placed.`);
      setRef("");
      setSupplier("");
      setTitle("");
      setAsin("");
      setQty("");
      setAmount("");
      await onRegistered();
    } catch {
      setError("Registration failed — network error.");
    } finally {
      setBusy(false);
    }
  };

  const field = "text-sm px-3 py-2 rounded-lg border border-gray-300 w-full";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold" style={{ color: "#0D1B2A" }}>
            Register external order
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            For orders placed outside the app (e.g. a distributor portal order like Petra). The order
            is recorded at <strong>Placed</strong> with a manual milestone; later evidence extends
            its journey.
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="text-sm font-semibold px-4 py-2 rounded-lg"
          style={{ background: "#0D1B2A", color: "#FFFFFF" }}
        >
          {open ? "Hide form" : "Register an order"}
        </button>
      </div>

      {open && (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Ref (PO / order #) *</span>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="FS-PETRA-2026-001" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Supplier *</span>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Petra Industries" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Title *</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Petra order — 7 lines" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">ASIN (optional)</span>
              <input value={asin} onChange={(e) => setAsin(e.target.value)} placeholder="B01234567X" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Qty (optional)</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="28" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Amount $ (optional)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="811.72" className={field} />
            </label>
          </div>
          {error && (
            <p className="text-sm mt-3" style={{ color: "#991B1B" }}>
              {error}
            </p>
          )}
          {msg && (
            <p className="text-sm mt-3" style={{ color: "#065F46" }}>
              {msg}
            </p>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className="text-sm font-semibold px-4 py-2 rounded-lg mt-4"
            style={{ background: "#D4AF37", color: "#0D1B2A", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Registering…" : "Register order"}
          </button>
        </div>
      )}
    </div>
  );
}
