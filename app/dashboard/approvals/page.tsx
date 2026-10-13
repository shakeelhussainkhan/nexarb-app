"use client";

import { useCallback, useEffect, useState } from "react";

type Approval = {
  asin: string;
  title: string | null;
  approvalUrl: string;
  channel: string;
  netPerUnit: number;
  marginPct: number;
  buyPrice: number | null;
  sellPrice: number | null;
  status: "pending" | "applied" | "dismissed";
  firstSeenAt: string;
  lastSeenAt: string;
  alertedAt: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "#FEF3C7", text: "#92400E", label: "Awaiting application" },
  applied: { bg: "#D1FAE5", text: "#065F46", label: "Applied" },
  dismissed: { bg: "#E5E7EB", text: "#374151", label: "Dismissed" },
};

function money(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(2)}`;
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals");
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { approvals: Approval[] };
      setRows(Array.isArray(data.approvals) ? data.approvals : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  async function decide(asin: string, action: "applied" | "dismissed" | "pending") {
    setBusy(asin + action);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, action }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      setNotice(
        action === "applied"
          ? `Marked ${asin} as applied. Once Amazon approves the brand, scans can turn it into a buyable deal.`
          : action === "dismissed"
            ? `Dismissed ${asin} — scans won't queue or alert it again.`
            : `Reopened ${asin} in the queue.`
      );
      fetchRows();
    } catch (e) {
      setNotice(`Could not save — ${e instanceof Error ? e.message : "server didn't confirm"}.`);
    } finally {
      setBusy(null);
    }
  }

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  function Row({ r }: { r: Approval }) {
    const style = STATUS_STYLE[r.status];
    return (
      <tr className="border-t border-gray-100 align-top">
        <td className="py-3 pr-4">
          <div className="font-medium text-sm" style={{ color: "#0D1B2A" }}>
            {r.title ?? r.asin}
          </div>
          <div className="text-xs text-gray-500">{r.asin}</div>
        </td>
        <td className="py-3 pr-4 text-sm">{money(r.buyPrice)}</td>
        <td className="py-3 pr-4 text-sm">{money(r.sellPrice)}</td>
        <td className="py-3 pr-4 text-sm font-medium" style={{ color: "#065F46" }}>
          {money(r.netPerUnit)}
        </td>
        <td className="py-3 pr-4 text-sm">{r.marginPct.toFixed(1)}%</td>
        <td className="py-3 pr-4 text-sm">{r.channel}</td>
        <td className="py-3 pr-4">
          <span
            className="text-xs font-medium px-2 py-1 rounded-full"
            style={{ background: style.bg, color: style.text }}
          >
            {style.label}
          </span>
        </td>
        <td className="py-3">
          <div className="flex flex-wrap gap-2">
            {r.status === "pending" && (
              <>
                <a
                  href={r.approvalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                  style={{ background: "#D4AF37", color: "#0D1B2A" }}
                >
                  Apply on Amazon
                </a>
                <button
                  onClick={() => decide(r.asin, "applied")}
                  disabled={busy !== null}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-50"
                >
                  Mark applied
                </button>
                <button
                  onClick={() => decide(r.asin, "dismissed")}
                  disabled={busy !== null}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </>
            )}
            {r.status !== "pending" && (
              <button
                onClick={() => decide(r.asin, "pending")}
                disabled={busy !== null}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-50"
              >
                Reopen
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0D1B2A" }}>
          Approval Queue
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Profitable products your account can&apos;t list yet because Amazon requires brand approval.
          Scans add items here automatically when the numbers clear your 25% margin bar. Applying happens
          on Amazon — some brands approve instantly, others ask for distributor invoices. Mark each item
          applied or dismissed and scans will respect your decision.
        </p>
      </div>

      {notice && (
        <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: "#FFFBEB", color: "#92400E" }}>
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading the queue…</p>
      ) : loadError ? (
        <p className="text-sm" style={{ color: "#991B1B" }}>
          Couldn&apos;t load the approval queue. If this is new, the database table may not be set up yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nothing gated-and-profitable yet. When a scan finds one, it lands here and you get a Telegram alert.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th className="pb-2 pr-4">Product</th>
                <th className="pb-2 pr-4">Buy $</th>
                <th className="pb-2 pr-4">Sell $</th>
                <th className="pb-2 pr-4">Net / unit</th>
                <th className="pb-2 pr-4">Margin</th>
                <th className="pb-2 pr-4">Channel</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <Row key={r.asin} r={r} />
              ))}
              {decided.map((r) => (
                <Row key={r.asin} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
