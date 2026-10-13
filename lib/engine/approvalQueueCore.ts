// Approval queue — pure decision logic.
//
// Some scanned products are profitable but GATED: Amazon requires brand
// approval before this account may list them (eligibility state
// APPROVAL_REQUIRED). Those items can't become BUY verdicts, but the
// approval itself is worth chasing when the money is good. This module
// decides which gated items enter the approval queue and when the
// founder hears about them.
//
// Rules:
//   - Eligibility must be APPROVAL_REQUIRED and Amazon must have given
//     at least one approval-application link (no link = no pathway).
//   - The best channel's per-unit economics must clear the bar:
//     net profit > 0 AND margin >= MIN_APPROVAL_MARGIN_PCT (the same 25%
//     target the verdict engine uses) at the live sell price.
//   - Queue writes: a new ASIN inserts as "pending"; a pending row
//     refreshes its economics each qualifying scan; "applied" and
//     "dismissed" rows are the founder's decisions and are never
//     overwritten or resurrected by scans.
//   - Alerting: one Telegram alert per queue entry, fired on insert —
//     or on a later scan if the insert's alert failed to land (the row
//     stays un-alerted until a send succeeds). Landed alerts never repeat.
//
// Pure (no network, no secrets) so the offline harness can exercise
// every rule.

import type { ChannelEvaluation } from "./verdict";

/** Margin floor for the approval queue, in percent — matches the
 * verdict engine's target margin. */
export const MIN_APPROVAL_MARGIN_PCT = 25;

export type ApprovalStatus = "pending" | "applied" | "dismissed";

export interface ApprovalCandidate {
  asin: string;
  approvalUrl: string;
  channel: string;
  netPerUnit: number;
  marginPct: number;
  buyPrice: number;
  sellPrice: number | null;
}

export interface ApprovalQueueRow extends ApprovalCandidate {
  title: string | null;
  status: ApprovalStatus;
  alertedAt: string | null;
}

/** The channel with the highest per-unit net profit (ties keep order). */
export function pickBestChannel(
  channels: ChannelEvaluation[] | null | undefined
): ChannelEvaluation | null {
  let best: ChannelEvaluation | null = null;
  for (const ch of channels ?? []) {
    if (!ch || !Number.isFinite(ch.netProfit)) continue;
    if (best === null || ch.netProfit > best.netProfit) best = ch;
  }
  return best;
}

/**
 * Decide whether one deal check belongs in the approval queue. Returns
 * the candidate economics, or null with the reason it doesn't qualify.
 */
export function evaluateApprovalCandidate(input: {
  asin: string;
  eligibilityState: string;
  approvalLinks: string[] | null | undefined;
  channels: ChannelEvaluation[] | null | undefined;
  buyPrice: number;
  sellPrice: number | null;
}): { candidate: ApprovalCandidate | null; reason: string } {
  if (input.eligibilityState !== "APPROVAL_REQUIRED") {
    return { candidate: null, reason: "not gated (eligibility is not APPROVAL_REQUIRED)" };
  }
  const url = (input.approvalLinks ?? []).map((l) => (l ?? "").trim()).find(Boolean);
  if (!url) {
    return { candidate: null, reason: "gated but Amazon returned no approval-application link" };
  }
  const best = pickBestChannel(input.channels);
  if (!best) {
    return { candidate: null, reason: "gated but no channel economics available" };
  }
  if (!(best.netProfit > 0)) {
    return {
      candidate: null,
      reason: `gated but not profitable on the best channel (${best.channel}: $${best.netProfit.toFixed(2)}/unit)`,
    };
  }
  if (best.marginPct < MIN_APPROVAL_MARGIN_PCT) {
    return {
      candidate: null,
      reason: `gated and profitable but margin ${best.marginPct.toFixed(1)}% is below the ${MIN_APPROVAL_MARGIN_PCT}% bar (${best.channel})`,
    };
  }
  return {
    candidate: {
      asin: input.asin,
      approvalUrl: url,
      channel: best.channel,
      netPerUnit: Math.round(best.netProfit * 100) / 100,
      marginPct: Math.round(best.marginPct * 10) / 10,
      buyPrice: input.buyPrice,
      sellPrice: input.sellPrice,
    },
    reason: `gated and clears the bar on ${best.channel}: $${best.netProfit.toFixed(2)}/unit at ${best.marginPct.toFixed(1)}% margin`,
  };
}

export interface QueueAction {
  /** insert = create pending row; refresh = update economics of a pending
   * row; none = leave the table alone. */
  write: "insert" | "refresh" | "none";
  /** Fire the Telegram alert after a successful write. */
  shouldAlert: boolean;
  reason: string;
}

/** Decide what a qualifying scan does to an existing queue row. */
export function decideQueueAction(
  existing: Pick<ApprovalQueueRow, "status" | "alertedAt"> | null
): QueueAction {
  if (!existing) {
    return { write: "insert", shouldAlert: true, reason: "new gated candidate — queue it and alert" };
  }
  if (existing.status === "pending") {
    return {
      write: "refresh",
      shouldAlert: existing.alertedAt === null,
      reason:
        existing.alertedAt === null
          ? "queued but the alert never landed — refresh economics and send it now"
          : "already queued and alerted — refresh economics, never re-alert",
    };
  }
  return {
    write: "none",
    shouldAlert: false,
    reason: `founder marked this ${existing.status} — scans never override that`,
  };
}

/** Rank queue rows for display: pending first, then margin desc, then
 * net per unit desc. Applied/dismissed keep their relative order after. */
export function rankApprovalQueue<
  T extends { marginPct: number; netPerUnit: number; status: ApprovalStatus }
>(rows: T[]): T[] {
  const weight = (s: ApprovalStatus): number => (s === "pending" ? 0 : s === "applied" ? 1 : 2);
  return [...rows].sort((a, b) => {
    const w = weight(a.status) - weight(b.status);
    if (w !== 0) return w;
    if (b.marginPct !== a.marginPct) return b.marginPct - a.marginPct;
    return b.netPerUnit - a.netPerUnit;
  });
}
