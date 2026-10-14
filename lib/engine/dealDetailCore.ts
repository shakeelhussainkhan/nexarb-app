// Pure aggregation for the per-ASIN deal detail (GET /api/deals/[asin]).
//
// The route does the DB reads; everything that turns raw rows into the
// response shape lives here so it is harness-testable offline. The Deal
// itself comes from dealFromCheckRow (lib/engine/dealCore.ts) — the exact
// mapping the deals list uses — with velocity/product info layered on by
// the route. Nothing here invents data: absent inputs stay null/empty.

import type { Deal } from "@/lib/engine/dealCore";

/** Watchlist facts for one ASIN (migrations 006/008/017 columns). */
export interface WatchlistFacts {
  asin: string;
  discoveryTitle: string;
  buyPrice: number;
  buySource: string;
  category: string | null;
  active: boolean;
  addedAt: string;
  sourceUrl: string | null;
  productTitle: string | null;
  productBrand: string | null;
  productImageUrl: string | null;
}

export interface RecentCheck {
  checkedAt: string;
  buyPrice: number;
  sellPrice: number | null;
  verdict: "BUY" | "SKIP" | "UNKNOWN";
  eligibility: string;
  netProfit: number | null;
  marginPct: number | null;
  floorPrice: number | null;
}

export interface BuyBoxObservationOut {
  checkedAt: string;
  sellPrice: number | null;
  winner: "us" | "competitor" | "unknown";
}

/** approval_queue row (migration 013), camelCased. */
export interface ApprovalInfo {
  status: "pending" | "applied" | "dismissed";
  approvalUrl: string;
  channel: string;
  netPerUnit: number;
  marginPct: number;
  buyPrice: number | null;
  sellPrice: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DealDetail {
  asin: string;
  onWatchlist: boolean;
  /** Latest engine view; null when the ASIN has never been checked. */
  deal: Deal | null;
  /** Eligibility from the latest check ("UNKNOWN" when never checked). */
  eligibility: string;
  /** Where the buy price comes from (watchlist row preferred). */
  source: {
    buySource: string;
    sourceUrl: string | null;
    retailerLabel: string;
  } | null;
  watchlist: WatchlistFacts | null;
  /** Newest first, capped by the route (10). */
  recentChecks: RecentCheck[];
  /** Oldest first, matching /api/deals/history's buybox payload. */
  buybox: BuyBoxObservationOut[];
  approval: ApprovalInfo | null;
}

interface RawCheckRow {
  buy_price: number | string;
  sell_price: number | string | null;
  verdict: string;
  eligibility: string;
  net_profit: number | string | null;
  margin_pct: number | string | null;
  floor_price: number | string | null;
  checked_at: string;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function recentCheckFromRow(row: RawCheckRow): RecentCheck {
  return {
    checkedAt: row.checked_at,
    buyPrice: numOrNull(row.buy_price) ?? 0,
    sellPrice: numOrNull(row.sell_price),
    verdict:
      row.verdict === "BUY" || row.verdict === "SKIP" ? row.verdict : "UNKNOWN",
    eligibility: row.eligibility,
    netProfit: numOrNull(row.net_profit),
    marginPct: numOrNull(row.margin_pct),
    floorPrice: numOrNull(row.floor_price),
  };
}

/** Same winner normalization as /api/deals/history's buybox payload. */
export function buyBoxWinner(raw: unknown): "us" | "competitor" | "unknown" {
  return raw === "us" || raw === "competitor" ? raw : "unknown";
}

export function buyBoxObservationsFromRows(
  rows: Array<{
    checked_at: string;
    sell_price: number | string | null;
    buybox_winner?: string | null;
  }>
): BuyBoxObservationOut[] {
  return rows.map((r) => ({
    checkedAt: r.checked_at,
    sellPrice: numOrNull(r.sell_price),
    winner: buyBoxWinner(r.buybox_winner),
  }));
}

interface RawApprovalRow {
  status: string;
  approval_url: string;
  channel: string;
  net_per_unit: number | string;
  margin_pct: number | string;
  buy_price: number | string | null;
  sell_price: number | string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export function approvalInfoFromRow(
  row: RawApprovalRow | null | undefined
): ApprovalInfo | null {
  if (!row) return null;
  return {
    status:
      row.status === "applied" || row.status === "dismissed"
        ? row.status
        : "pending",
    approvalUrl: row.approval_url,
    channel: row.channel,
    netPerUnit: numOrNull(row.net_per_unit) ?? 0,
    marginPct: numOrNull(row.margin_pct) ?? 0,
    buyPrice: numOrNull(row.buy_price),
    sellPrice: numOrNull(row.sell_price),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Human retailer label for a deal_checks/watchlist buy_source tag. */
export function retailerLabelFromBuySource(buySource: string): string {
  const s = (buySource ?? "").toLowerCase();
  if (s.includes("walmart")) return "Walmart";
  if (s.includes("target")) return "Target";
  if (s.includes("costco")) return "Costco";
  if (s.includes("alibaba")) return "Alibaba";
  if (s.includes("amazon")) return "Amazon";
  return "Manual";
}

export function buildDealDetail(input: {
  asin: string;
  watchlist: WatchlistFacts | null;
  deal: Deal | null;
  latestEligibility: string | null;
  recentCheckRows: RawCheckRow[];
  buyboxRows: Array<{
    checked_at: string;
    sell_price: number | string | null;
    buybox_winner?: string | null;
  }>;
  approvalRow: RawApprovalRow | null | undefined;
  latestBuySource: string | null;
}): DealDetail {
  const source = input.watchlist
    ? {
        buySource: input.watchlist.buySource,
        sourceUrl: input.watchlist.sourceUrl,
        retailerLabel: retailerLabelFromBuySource(input.watchlist.buySource),
      }
    : input.latestBuySource
      ? {
          buySource: input.latestBuySource,
          sourceUrl: null,
          retailerLabel: retailerLabelFromBuySource(input.latestBuySource),
        }
      : null;
  return {
    asin: input.asin,
    onWatchlist: input.watchlist !== null,
    deal: input.deal,
    eligibility: input.latestEligibility ?? "UNKNOWN",
    source,
    watchlist: input.watchlist,
    recentChecks: input.recentCheckRows.map(recentCheckFromRow),
    buybox: buyBoxObservationsFromRows(input.buyboxRows),
    approval: approvalInfoFromRow(input.approvalRow),
  };
}
