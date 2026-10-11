"use client";

import { useState } from "react";

type Verdict = "BUY" | "SKIP" | "UNKNOWN";

interface PurchaseGuardProps {
  verdict: Verdict;
  reasons: string[];
  asin: string;
  // Called only after the verdict is BUY AND a fresh eligibility check comes
  // back sellable (not BLOCKED/UNKNOWN). It must create a PENDING_APPROVAL
  // intent (POST /api/purchases) — never execute a purchase by itself.
  onConfirm: (asin: string) => void | Promise<void>;
}

// Wraps the Buy button on a deal row. Two hard gates before the user can even
// attempt a purchase:
//   1. Engine verdict must be BUY — SKIP/UNKNOWN render a disabled button
//      with the reason inline.
//   2. On click, eligibility is re-checked live (GET /api/deals/eligibility).
//      A BLOCKED/UNKNOWN answer (or a failed check) blocks and shows the
//      reason instead of proceeding.
// This component never auto-purchases: proceeding only fires onConfirm, which
// records an intent that still requires human approval.
export default function PurchaseGuard({ verdict, reasons, asin, onConfirm }: PurchaseGuardProps) {
  const [checking, setChecking] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  if (verdict !== "BUY") {
    const reason = reasons[0] ?? `Verdict is ${verdict}.`;
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          disabled
          title={reason}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-300 bg-gray-100 cursor-not-allowed"
        >
          Buy
        </button>
        <span className="block max-w-56 whitespace-normal text-[11px] leading-snug text-gray-400">
          {reason}
        </span>
      </span>
    );
  }

  async function handleClick() {
    setBlockReason(null);
    setChecking(true);
    try {
      const res = await fetch(`/api/deals/eligibility?asin=${encodeURIComponent(asin)}`);
      if (!res.ok) throw new Error(`eligibility check ${res.status}`);
      const data = (await res.json()) as { state?: string; reasons?: string[] };
      if (data.state === "BLOCKED" || data.state === "UNKNOWN" || !data.state) {
        const why =
          (data.reasons && data.reasons[0]) ||
          `Eligibility is ${data.state ?? "unavailable"} — purchase blocked until eligibility is confirmed.`;
        setBlockReason(why);
        return;
      }
      // APPROVAL_REQUIRED proceeds: it still creates only a PENDING_APPROVAL
      // intent, and approval happens after the application path is reviewed.
      await onConfirm(asin);
    } catch (e) {
      // A failed check is treated as UNKNOWN, never as a green light.
      setBlockReason(
        `Eligibility check failed (${e instanceof Error ? e.message : "network error"}) — purchase blocked until eligibility is confirmed.`
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        onClick={handleClick}
        disabled={checking}
        className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
        style={{ background: "#B8922A" }}
      >
        {checking ? "Checking…" : "Buy"}
      </button>
      {blockReason && (
        <span className="block max-w-56 whitespace-normal text-[11px] leading-snug text-red-500">
          {blockReason}
        </span>
      )}
    </span>
  );
}
