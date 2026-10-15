// Guarded purchasing: spend caps, kill switch, and the purchase-intent
// state machine. Pure functions with injectable state so every rule is
// unit-testable offline. Nothing here touches the network or a database.
//
// Founder-confirmed guardrail defaults (2026-10-14). Environment variables
// may override them; they are labelled "default" wherever they are surfaced
// (API responses, UI).

import type { EligibilityState } from "./eligibility.ts";

export type GuardVerdict = "BUY" | "SKIP" | "UNKNOWN";
export type PurchaseStatus = "PENDING_APPROVAL" | "APPROVED" | "EXECUTED" | "REJECTED";

// --- Spend caps -------------------------------------------------------------

export interface SpendCaps {
  dailySpendCap: number; // USD per day across all intents
  perOrderCap: number; // USD per single purchase intent
  maxUnitsPerAsin: number; // units per ASIN per day
}

// Founder-confirmed default guardrails (2026-10-14).
export const DEFAULT_SPEND_CAPS: SpendCaps = {
  dailySpendCap: 5000, // founder-confirmed default (raised from 2500 on 2026-10-15 for the Q4 import program; per-order cap stays 1500, units cap stays 20)
  perOrderCap: 1500, // founder-confirmed default (raised from 1000 on 2026-10-15)
  maxUnitsPerAsin: 20, // founder-confirmed default
};

// Already-committed spend, injected by the caller (Supabase query or
// in-memory tally). "Today" is the caller's responsibility (UTC day boundary).
export interface SpendUsage {
  spentToday: number; // USD committed today (non-rejected intents)
  unitsForAsinToday: number; // units committed for this ASIN today
}

function numEnv(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function capsFromEnv(env: Record<string, string | undefined>): SpendCaps {
  return {
    dailySpendCap: numEnv(env, "NEXARB_DAILY_SPEND_CAP", DEFAULT_SPEND_CAPS.dailySpendCap),
    perOrderCap: numEnv(env, "NEXARB_PER_ORDER_CAP", DEFAULT_SPEND_CAPS.perOrderCap),
    maxUnitsPerAsin: numEnv(env, "NEXARB_MAX_UNITS_PER_ASIN", DEFAULT_SPEND_CAPS.maxUnitsPerAsin),
  };
}

export function killSwitchFromEnv(env: Record<string, string | undefined>): boolean {
  const raw = (env.NEXARB_PURCHASE_KILL_SWITCH ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// --- Intent creation gate ---------------------------------------------------

export interface IntentInput {
  verdict: GuardVerdict;
  eligibility: EligibilityState;
  asin: string;
  qty: number;
  unitPrice: number;
  caps: SpendCaps;
  usage: SpendUsage; // injectable committed-spend state
  killSwitchOn: boolean;
  recheckDone: boolean; // was eligibility synchronously re-checked for this intent?
  // Import intents (Alibaba order drafts) ONLY: bulk quantities are the
  // point of the import channel, so the per-ASIN unit cap — a retail-deal
  // guardrail — does not apply. The dollar caps (per-order + daily) still
  // bind in full. Retail callers must leave this unset.
  exemptUnitsCap?: boolean;
}

export interface GuardDecision {
  allowed: boolean;
  reasons: string[];
}

// Every guard is ANDed: the first failure does not hide the others, so the
// caller (and the founder) sees the full set of blockers.
export function canCreateIntent(input: IntentInput): GuardDecision {
  const reasons: string[] = [];

  if (input.killSwitchOn) {
    reasons.push("Purchasing kill switch is ON — all purchase intents are blocked.");
  }
  if (input.verdict !== "BUY") {
    reasons.push(`Engine verdict is ${input.verdict} — a purchase intent requires BUY.`);
  }
  if (input.eligibility === "BLOCKED") {
    reasons.push("Amazon eligibility is BLOCKED — this ASIN cannot be listed, so it cannot be purchased.");
  }
  if (input.eligibility === "UNKNOWN") {
    reasons.push("Amazon eligibility is UNKNOWN — a successful re-check is required before any purchase.");
  }
  if (!input.recheckDone) {
    reasons.push("Eligibility re-check required before intent creation — no stale or cached-only answer accepted.");
  }
  if (!(input.qty > 0) || !Number.isFinite(input.qty)) {
    reasons.push(`Quantity ${input.qty} is not a positive number.`);
  }
  if (!(input.unitPrice > 0) || !Number.isFinite(input.unitPrice)) {
    reasons.push(`Unit price ${input.unitPrice} is not a positive number.`);
  }

  const orderTotal = input.qty * input.unitPrice;
  if (Number.isFinite(orderTotal)) {
    if (orderTotal > input.caps.perOrderCap) {
      reasons.push(
        `Order total $${orderTotal.toFixed(2)} exceeds the per-order cap of $${input.caps.perOrderCap.toFixed(2)} (founder-confirmed default).`
      );
    }
    if (input.usage.spentToday + orderTotal > input.caps.dailySpendCap) {
      reasons.push(
        `Would exceed the daily spend cap of $${input.caps.dailySpendCap.toFixed(2)} (founder-confirmed default): $${input.usage.spentToday.toFixed(2)} already committed today.`
      );
    }
  }

  if (!input.exemptUnitsCap) {
    const unitsAfter = input.usage.unitsForAsinToday + input.qty;
    if (unitsAfter > input.caps.maxUnitsPerAsin) {
      reasons.push(
        `Would exceed the ${input.caps.maxUnitsPerAsin} units/ASIN cap (founder-confirmed default): ${input.usage.unitsForAsinToday} already committed for ${input.asin} today.`
      );
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

// --- State machine ----------------------------------------------------------

// PENDING_APPROVAL -> APPROVED -> EXECUTED
// PENDING_APPROVAL -> REJECTED, APPROVED -> REJECTED
// EXECUTED and REJECTED are terminal.
const VALID_TRANSITIONS: Record<PurchaseStatus, PurchaseStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED", "REJECTED"],
  EXECUTED: [],
  REJECTED: [],
};

export function canTransition(from: PurchaseStatus, to: PurchaseStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function validNextStatuses(from: PurchaseStatus): PurchaseStatus[] {
  return [...VALID_TRANSITIONS[from]];
}

// --- Audit ------------------------------------------------------------------

export interface AuditEntry {
  purchaseId: string;
  action: string;
  actor: string;
  reason: string | null;
  createdAt: string; // ISO
}

export function buildAuditEntry(
  purchaseId: string,
  action: string,
  actor: string,
  reason?: string | null,
  now: Date = new Date()
): AuditEntry {
  return {
    purchaseId,
    action,
    actor,
    reason: reason ?? null,
    createdAt: now.toISOString(),
  };
}

// --- Intent record + store contract -----------------------------------------

export interface PurchaseIntentRecord {
  id: string;
  asin: string;
  qty: number;
  unitPrice: number;
  verdict: GuardVerdict;
  eligibility: EligibilityState;
  status: PurchaseStatus;
  createdBy: string;
  createdAt: string; // ISO
  decidedAt: string | null; // ISO
  decidedBy: string | null;
  decisionReason: string | null;
  retailerUrl?: string | null; // retailer product page (migration 008)
  checkoutStatus?: string | null; // assisted-checkout lifecycle (migration 008)
}

export interface NewIntent {
  asin: string;
  qty: number;
  unitPrice: number;
  verdict: GuardVerdict;
  eligibility: EligibilityState;
  createdBy: string;
  retailerUrl?: string | null;
}

// Storage contract shared by the API routes. Supabase when configured,
// in-memory otherwise — the routes choose the implementation.
export interface PurchaseStore {
  createIntent(input: NewIntent): PurchaseIntentRecord;
  getIntent(id: string): PurchaseIntentRecord | undefined;
  // Returns undefined when the id does not exist or the transition is invalid.
  transition(id: string, to: PurchaseStatus, decidedBy: string, reason: string | null): PurchaseIntentRecord | undefined;
  appendAudit(entry: AuditEntry): void;
  usageFor(asin: string, since: Date): SpendUsage;
  allIntents(): PurchaseIntentRecord[];
  setCheckoutStatus(id: string, to: string): PurchaseIntentRecord | undefined;
}

let intentSeq = 0;
export function newIntentId(): string {
  intentSeq += 1;
  return `pi_${Date.now().toString(36)}_${intentSeq.toString(36)}`;
}

// --- Shared helpers for the API routes -------------------------------------

// True when the Supabase env is present; the API routes persist to Supabase
// only in that case and fall back to the in-memory store otherwise.
export function supabaseIsConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL);
}

// UTC midnight boundary used to scope "today" for daily caps.
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Per-process in-memory store. HONEST LIMITATION: this is a single-process
// fallback for local dev / unconfigured Supabase only — it is NOT shared
// across server instances and is lost on restart. Production must use the
// Supabase implementation (see supabase/migrations/004_guarded_purchases.sql).
export class InMemoryPurchaseStore implements PurchaseStore {
  private intents = new Map<string, PurchaseIntentRecord>();
  private audits: AuditEntry[] = [];

  createIntent(input: NewIntent): PurchaseIntentRecord {
    const now = new Date().toISOString();
    const rec: PurchaseIntentRecord = {
      id: newIntentId(),
      asin: input.asin,
      qty: input.qty,
      unitPrice: input.unitPrice,
      verdict: input.verdict,
      eligibility: input.eligibility,
      status: "PENDING_APPROVAL",
      createdBy: input.createdBy,
      createdAt: now,
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      retailerUrl: input.retailerUrl ?? null,
      checkoutStatus: "none",
    };
    this.intents.set(rec.id, rec);
    return { ...rec };
  }

  getIntent(id: string): PurchaseIntentRecord | undefined {
    const rec = this.intents.get(id);
    return rec ? { ...rec } : undefined;
  }

  transition(
    id: string,
    to: PurchaseStatus,
    decidedBy: string,
    reason: string | null
  ): PurchaseIntentRecord | undefined {
    const rec = this.intents.get(id);
    if (!rec || !canTransition(rec.status, to)) return undefined;
    rec.status = to;
    rec.decidedAt = new Date().toISOString();
    rec.decidedBy = decidedBy;
    rec.decisionReason = reason;
    return { ...rec };
  }

  appendAudit(entry: AuditEntry): void {
    this.audits.push(entry);
  }

  auditsFor(purchaseId: string): AuditEntry[] {
    return this.audits.filter((a) => a.purchaseId === purchaseId);
  }

  usageFor(asin: string, since: Date): SpendUsage {
    let spentToday = 0;
    let unitsForAsinToday = 0;
    for (const rec of this.intents.values()) {
      if (rec.status === "REJECTED") continue;
      if (new Date(rec.createdAt) < since) continue;
      spentToday += rec.qty * rec.unitPrice;
      if (rec.asin === asin) unitsForAsinToday += rec.qty;
    }
    return { spentToday, unitsForAsinToday };
  }

  allIntents(): PurchaseIntentRecord[] {
    return [...this.intents.values()].map((rec) => ({ ...rec }));
  }

  /** Assisted-checkout lifecycle update (migration 008). No guard on the
   *  value here — callers validate via lib/engine/checkout.ts first. */
  setCheckoutStatus(id: string, to: string): PurchaseIntentRecord | undefined {
    const rec = this.intents.get(id);
    if (!rec) return undefined;
    rec.checkoutStatus = to;
    return { ...rec };
  }
}

// Shared in-memory fallback instance used by the API routes when Supabase is
// not configured. Per-process only — see InMemoryPurchaseStore.
export const sharedMemoryStore = new InMemoryPurchaseStore();
