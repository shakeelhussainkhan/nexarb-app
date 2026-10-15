"use client";

import { useCallback, useEffect, useState } from "react";

type Offer = {
  id: string;
  supplier: string;
  supplierSku: string;
  vendorSku: string | null;
  title: string;
  brand: string | null;
  upc: string | null;
  costPrice: number;
  mapPrice: number | null;
  msrp: number | null;
  qtyAvailable: number;
  imageUrl: string | null;
  productClass: string | null;
  subcategory: string | null;
  matchedAsin: string | null;
  matchStatus: "pending" | "matched" | "no_match" | "error";
  amazonPrice: number | null;
  estNet: number | null;
  estMarginPct: number | null;
  pricedAt: string | null;
  evalVerdict: "candidate" | "watch" | "pass" | null;
  evalScore: number | null;
  evalReasons: string[];
  evaluatedAt: string | null;
  promotedAsin: string | null;
};

type Summary = {
  supplier: string;
  total: number;
  matched: number;
  pending: number;
  priced: number;
  candidates: number;
};

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  matched: { bg: "#D1FAE5", text: "#065F46", label: "Matched" },
  pending: { bg: "#FEF3C7", text: "#92400E", label: "Pending" },
  no_match: { bg: "#E5E7EB", text: "#374151", label: "No match" },
  error: { bg: "#FEE2E2", text: "#991B1B", label: "Error" },
};

const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  candidate: { bg: "#065F46", text: "#FFFFFF", label: "Candidate" },
  watch: { bg: "#FEF3C7", text: "#92400E", label: "Watch" },
  pass: { bg: "#E5E7EB", text: "#374151", label: "Pass" },
};

function money(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(2)}`;
}

export default function SuppliersPage() {
  const [rows, setRows] = useState<Offer[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("petra");
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const [minMargin, setMinMargin] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState(false);
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const params = new URLSearchParams({ supplier, limit: "300" });
      if (matchedOnly) params.set("matched", "1");
      if (candidatesOnly) params.set("candidates", "1");
      if (q.trim()) params.set("q", q.trim());
      const mm = Number(minMargin);
      if (minMargin.trim() && Number.isFinite(mm)) params.set("minMargin", String(mm));
      const res = await fetch(`/api/suppliers?${params.toString()}`);
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { offers: Offer[]; summary: Summary };
      setRows(Array.isArray(data.offers) ? data.offers : []);
      setSummary(data.summary ?? null);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [q, supplier, matchedOnly, candidatesOnly, minMargin]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const promoteSelected = async () => {
    if (selected.size === 0 || promoting) return;
    setPromoting(true);
    setPromoteMsg(null);
    try {
      const res = await fetch("/api/suppliers/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerIds: [...selected] }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        promoted?: Array<{ offerId: string; asin: string }>;
        skipped?: Array<{ offerId: string; reason: string }>;
        errors?: string[];
        error?: string;
      };
      if (!res.ok || !data.success) {
        setPromoteMsg(data.error ?? "Promotion failed.");
      } else {
        const promoted = data.promoted ?? [];
        const skipped = data.skipped ?? [];
        const parts = [`Promoted ${promoted.length} to the watchlist.`];
        if (skipped.length > 0) parts.push(`Skipped ${skipped.length}: ${skipped[0].reason}${skipped.length > 1 ? " …" : ""}`);
        if ((data.errors ?? []).length > 0) parts.push(`Errors: ${(data.errors ?? [])[0]}`);
        parts.push("They'll be re-checked by the next verification scan.");
        setPromoteMsg(parts.join(" "));
        setSelected(new Set());
        await fetchRows();
      }
    } catch {
      setPromoteMsg("Promotion failed — network error.");
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0D1B2A" }}>
          Suppliers
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Distributor catalog offers matched to Amazon ASINs. Petra&apos;s product list is ingested
          from its portal download; Frontier Co-op&apos;s comes from its published monthly catalog
          files. Matches resolve by UPC through SP-API, and priced rows carry an{" "}
          <em>estimated</em> net and margin — live Amazon price minus supplier cost, $1.50/unit 3PL
          prep, and estimated referral/FBA fees. Estimates are directional, never exact per-ASIN
          fees. Frontier files carry no stock counts, so Frontier stock shows as — (unknown, not
          zero on hand). Evaluated rows also carry a verdict — <strong>Candidate</strong> (clears
          the freight-aware profit bar with non-weak velocity), <strong>Watch</strong>, or{" "}
          <strong>Pass</strong> — scored with a Q4 seasonal boost. Promoting a candidate puts it on
          the watchlist, where the normal verification scan re-checks it before anything can be
          bought. Promotion itself buys nothing.
        </p>
      </div>

      {summary && (
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            [`${summary.total} offers`, "#0D1B2A"],
            [`${summary.matched} matched`, "#065F46"],
            [`${summary.pending} pending match`, "#92400E"],
            [`${summary.priced} priced`, "#065F46"],
            [`${summary.candidates ?? 0} candidates`, "#065F46"],
          ].map(([label, color]) => (
            <span
              key={label}
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 bg-white"
              style={{ color }}
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Supplier</span>
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white"
          >
            <option value="petra">Petra</option>
            <option value="frontier">Frontier Co-op</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, brand, SKU, UPC, ASIN"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 w-64"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">Min est. margin %</span>
          <input
            value={minMargin}
            onChange={(e) => setMinMargin(e.target.value)}
            placeholder="e.g. 25"
            inputMode="decimal"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 w-28"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={matchedOnly}
            onChange={(e) => setMatchedOnly(e.target.checked)}
          />
          Matched only
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={candidatesOnly}
            onChange={(e) => setCandidatesOnly(e.target.checked)}
          />
          Candidates only
        </label>
        <button
          onClick={fetchRows}
          className="text-sm font-semibold px-4 py-2 rounded-lg text-white mb-0.5"
          style={{ background: "#D4AF37", color: "#0D1B2A" }}
        >
          Refresh
        </button>
      </div>

      {(selected.size > 0 || promoteMsg) && (
        <div className="flex flex-wrap items-center gap-3 mb-5 px-4 py-3 rounded-lg border border-gray-200 bg-white">
          {selected.size > 0 && (
            <button
              onClick={promoteSelected}
              disabled={promoting}
              className="text-sm font-semibold px-4 py-2 rounded-lg"
              style={{ background: "#065F46", color: "#FFFFFF", opacity: promoting ? 0.6 : 1 }}
            >
              {promoting ? "Promoting…" : `Promote ${selected.size} candidate${selected.size === 1 ? "" : "s"} to watchlist`}
            </button>
          )}
          {promoteMsg && <p className="text-sm text-gray-600">{promoteMsg}</p>}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading supplier offers…</p>
      ) : loadError ? (
        <p className="text-sm" style={{ color: "#991B1B" }}>
          Couldn&apos;t load supplier offers. If this is new, the database tables may not be set up yet
          (migration 018).
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No offers match these filters. Ingest starts with a catalog feed — see{" "}
          <code>scripts/petra-ingest.mjs</code> (Petra portal download) or{" "}
          <code>scripts/frontier-ingest.mjs</code> (Frontier monthly XLSX files).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-2"></th>
                <th className="pb-2 pr-4">Product</th>
                <th className="pb-2 pr-4">SKU</th>
                <th className="pb-2 pr-4">UPC</th>
                <th className="pb-2 pr-4">ASIN</th>
                <th className="pb-2 pr-4">Cost</th>
                <th className="pb-2 pr-4">Stock</th>
                <th className="pb-2 pr-4">Amazon $</th>
                <th className="pb-2 pr-4">Est. net *</th>
                <th className="pb-2 pr-4">Est. margin *</th>
                <th className="pb-2 pr-4">Verdict</th>
                <th className="pb-2 pr-4">Score</th>
                <th className="pb-2">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const style = STATUS_STYLE[r.matchStatus] ?? STATUS_STYLE.pending;
                const verdictStyle = r.evalVerdict ? VERDICT_STYLE[r.evalVerdict] : null;
                const seasonalReasons = (r.evalReasons ?? []).filter((x) =>
                  x.startsWith("seasonal:")
                );
                const promotable = r.evalVerdict === "candidate" && !r.promotedAsin;
                return (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="py-3 pr-2">
                      {promotable ? (
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                          aria-label={`Select ${r.title} for promotion`}
                        />
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-start gap-3">
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.imageUrl}
                            alt=""
                            className="w-10 h-10 object-contain rounded border border-gray-100 bg-white shrink-0"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : null}
                        <div>
                          <div className="font-medium text-sm" style={{ color: "#0D1B2A" }}>
                            {r.title}
                          </div>
                          <div className="text-xs text-gray-500">
                            {r.brand ?? ""}
                            {r.productClass ? ` · ${r.productClass}` : ""}
                          </div>
                          {seasonalReasons.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {seasonalReasons.map((s) => (
                                <span
                                  key={s}
                                  className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                                  style={{ background: "#FDF2E3", color: "#9A6B1F" }}
                                >
                                  🎄 {s.replace("seasonal: ", "")}
                                </span>
                              ))}
                            </div>
                          )}
                          {r.promotedAsin && (
                            <div className="text-[11px] mt-1" style={{ color: "#065F46" }}>
                              On watchlist ✓
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-sm whitespace-nowrap">{r.supplierSku}</td>
                    <td className="py-3 pr-4 text-sm whitespace-nowrap">{r.upc ?? "—"}</td>
                    <td className="py-3 pr-4 text-sm whitespace-nowrap">
                      {r.matchedAsin ? (
                        <a
                          href={`https://www.amazon.com/dp/${r.matchedAsin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-dotted"
                        >
                          {r.matchedAsin}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 text-sm">{money(r.costPrice)}</td>
                    <td className="py-3 pr-4 text-sm">
                      {r.supplier === "frontier" ? "—" : r.qtyAvailable}
                    </td>
                    <td className="py-3 pr-4 text-sm">{money(r.amazonPrice)}</td>
                    <td
                      className="py-3 pr-4 text-sm font-medium"
                      style={{ color: r.estNet !== null && r.estNet < 0 ? "#991B1B" : "#065F46" }}
                    >
                      {money(r.estNet)}
                    </td>
                    <td className="py-3 pr-4 text-sm">
                      {r.estMarginPct === null ? "—" : `${r.estMarginPct.toFixed(1)}%`}
                    </td>
                    <td className="py-3 pr-4">
                      {verdictStyle ? (
                        <span
                          className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ background: verdictStyle.bg, color: verdictStyle.text }}
                          title={(r.evalReasons ?? []).join(" · ")}
                        >
                          {verdictStyle.label}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-sm">
                      {r.evalScore === null ? "—" : Math.round(r.evalScore)}
                    </td>
                    <td className="py-3">
                      <span
                        className="text-xs font-medium px-2 py-1 rounded-full"
                        style={{ background: style.bg, color: style.text }}
                      >
                        {style.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-3">
            * Estimates only — Amazon live landed price minus supplier cost, $1.50/unit prep, $0.45
            inbound, $0.35 storage, and estimated referral/FBA fees (lib/engine/pricing.ts fee stack).
            Verdicts additionally subtract modelled freight (8% of cost per unit unless an order
            reaches Petra&apos;s $800 free-freight threshold) and weigh BSR-model velocity,
            eligibility, stock, and a Q4 seasonal boost; hover a verdict for its full reasons.
          </p>
        </div>
      )}
    </div>
  );
}
