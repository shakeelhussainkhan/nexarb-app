// BSR → estimated-sales-per-day model (first-party Keepa-velocity replacement).
//
// Two inputs feed the number that drives buy quantities:
//   (a) estimateDailySales(): rank → units/day via per-category power-law
//       reference curves (the actual curves live in lib/engine/velocity.ts
//       as ANCHORS — single source of truth; this module adapts them).
//   (b) rankTrend(): improving/declining/stable from OUR OWN snapshot series,
//       with a minimum-span guard so two snapshots an hour apart never count
//       as a "trend".
//
// Every estimate is labeled as an estimate. With <2 snapshots, callers must
// report "insufficient data" — never a fabricated number.

import { bsrTrend, modelMonthlySales, confidenceForEvidence } from "./velocity.ts";
import type { MarketSnapshot } from "../data/types.ts";

export type RankTrend = "improving" | "declining" | "stable" | "insufficient";

export interface DailySalesEstimate {
  unitsPerDay: number; // 0 when the rank is invalid — never a fabricated positive
  confidence: "low" | "medium" | "high";
  basis: string; // human-readable provenance, always set
}

export interface SalesEvidence {
  snapshotCount: number;
  spanDays: number;
}

// Normalize free-text SP-API category titles to the ANCHORS key space:
// "Home and Kitchen" -> "home & kitchen", "Toys & Games" stays put.
// Unknown categories fall through to the "default" curve in modelMonthlySales.
export function normalizeCategory(category?: string | null): string {
  return (category ?? "")
    .trim()
    .toLowerCase()
    .replace(/\band\b/g, "&")
    .replace(/\s+/g, " ");
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Map a sales rank to estimated units/day. Pure model output — confidence is
 * "low" by design unless `evidence` (our own snapshot backing) is supplied:
 * model-only estimates stay LOW confidence per the house convention in
 * lib/engine/velocity.ts (commercial BSR→units models diverge ~19-30%).
 */
export function estimateDailySales(
  salesRank: number,
  category?: string | null,
  evidence?: SalesEvidence
): DailySalesEstimate {
  if (typeof salesRank !== "number" || !Number.isFinite(salesRank) || salesRank <= 0) {
    return {
      unitsPerDay: 0,
      confidence: "low",
      basis: "no valid sales rank — insufficient data, not estimated",
    };
  }
  const normalized = normalizeCategory(category);
  const monthly = modelMonthlySales(salesRank, normalized);
  const unitsPerDay = round1(monthly / 30);
  const confidence =
    evidence !== undefined
      ? confidenceForEvidence(evidence.snapshotCount, evidence.spanDays)
      : "low";
  const basis =
    `bsr-model estimate: rank ${Math.round(salesRank).toLocaleString("en-US")}` +
    (normalized ? ` in '${normalized}'` : "") +
    ` → ~${Math.round(monthly).toLocaleString("en-US")}/mo ÷ 30` +
    (evidence !== undefined
      ? `; backed by ${evidence.snapshotCount} snapshots over ${round1(evidence.spanDays)}d`
      : "; model-only, no snapshot backing");
  return { unitsPerDay, confidence, basis };
}

/**
 * Direction of the rank series from our own snapshots. The minimum-span guard
 * (default 1 day) refuses to call two snapshots taken minutes apart a trend —
 * rank jitter inside a single day is noise, not signal.
 */
export function rankTrend(snapshots: MarketSnapshot[], minSpanDays = 1): RankTrend {
  const ranked = snapshots
    .filter((s) => typeof s.salesRank === "number" && (s.salesRank as number) > 0)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (ranked.length < 2) return "insufficient";
  const spanDays =
    (Date.parse(ranked[ranked.length - 1].capturedAt) - Date.parse(ranked[0].capturedAt)) /
    86400000;
  if (!(spanDays >= minSpanDays)) return "insufficient";
  const t = bsrTrend(snapshots);
  if (t === "positive") return "improving"; // rank number falling = selling faster
  if (t === "negative") return "declining";
  if (t === "neutral") return "stable";
  return "insufficient";
}
