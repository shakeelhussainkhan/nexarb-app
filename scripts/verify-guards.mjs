// Offline harness for the guarded-purchasing engine. Run: node scripts/verify-guards.mjs
// Imports lib/engine/guards.ts directly (Node 23 strips types).
import {
  canCreateIntent,
  canTransition,
  buildAuditEntry,
  capsFromEnv,
  killSwitchFromEnv,
  InMemoryPurchaseStore,
  DEFAULT_SPEND_CAPS,
} from "../lib/engine/guards.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

const base = () => ({
  verdict: "BUY",
  eligibility: "SELLABLE",
  asin: "B012345678",
  qty: 5,
  unitPrice: 20, // $100 order
  caps: { ...DEFAULT_SPEND_CAPS },
  usage: { spentToday: 0, unitsForAsinToday: 0 },
  killSwitchOn: false,
  recheckDone: true,
});

// 1. Non-BUY verdicts are blocked.
check("SKIP verdict blocked", (() => {
  const d = canCreateIntent({ ...base(), verdict: "SKIP" });
  return !d.allowed && d.reasons.some((r) => r.includes("SKIP"));
})());
check("UNKNOWN verdict blocked", (() => {
  const d = canCreateIntent({ ...base(), verdict: "UNKNOWN" });
  return !d.allowed && d.reasons.some((r) => r.includes("UNKNOWN"));
})());

// 2. Eligibility states that are not a green light are blocked.
check("BLOCKED eligibility blocked", (() => {
  const d = canCreateIntent({ ...base(), eligibility: "BLOCKED" });
  return !d.allowed && d.reasons.some((r) => r.includes("BLOCKED"));
})());
check("UNKNOWN eligibility blocked", (() => {
  const d = canCreateIntent({ ...base(), eligibility: "UNKNOWN" });
  return !d.allowed && d.reasons.some((r) => r.includes("UNKNOWN"));
})());
check("APPROVAL_REQUIRED eligibility allowed (still only an intent)", (() => {
  const d = canCreateIntent({ ...base(), eligibility: "APPROVAL_REQUIRED" });
  return d.allowed;
})());

// 3. Spend caps.
check("daily cap accumulation blocked", (() => {
  const d = canCreateIntent({
    ...base(),
    qty: 9,
    unitPrice: 100,
    usage: { spentToday: 1700, unitsForAsinToday: 0 },
  }); // $1,700 already committed + $900 order > $2,500 daily cap
  return !d.allowed && d.reasons.some((r) => r.includes("daily spend cap"));
})());
check("per-order cap allows a $1,400 order", (() => {
  const d = canCreateIntent({ ...base(), qty: 14, unitPrice: 100 }); // $1,400 <= $1,500
  return d.allowed && d.reasons.length === 0;
})());
check("per-order cap blocks a $1,600 order", (() => {
  const d = canCreateIntent({ ...base(), qty: 16, unitPrice: 100 }); // $1,600 > $1,500
  return !d.allowed && d.reasons.some((r) => r.includes("per-order cap"));
})());
check("per-ASIN cap blocked", (() => {
  const d = canCreateIntent({ ...base(), qty: 5, usage: { spentToday: 0, unitsForAsinToday: 18 } }); // 18+5 > 20
  return !d.allowed && d.reasons.some((r) => r.includes("units/ASIN"));
})());
check("per-ASIN cap skipped only with exemptUnitsCap (import intents)", (() => {
  const d = canCreateIntent({ ...base(), qty: 350, unitPrice: 2.73, exemptUnitsCap: true }); // $955.50 import order
  return d.allowed && d.reasons.length === 0;
})());
check("exempt import intent still bound by the per-order dollar cap", (() => {
  const d = canCreateIntent({ ...base(), qty: 600, unitPrice: 2.73, exemptUnitsCap: true }); // $1,638 > $1,500
  return !d.allowed && d.reasons.some((r) => r.includes("per-order cap")) && !d.reasons.some((r) => r.includes("units/ASIN"));
})());

// 4. Kill switch blocks even a perfect deal.
check("kill switch blocks everything", (() => {
  const d = canCreateIntent({ ...base(), killSwitchOn: true });
  return !d.allowed && d.reasons.some((r) => r.includes("kill switch"));
})());

// 5. Eligibility must be freshly re-checked for the intent.
check("recheck required before intent creation", (() => {
  const d = canCreateIntent({ ...base(), recheckDone: false });
  return !d.allowed && d.reasons.some((r) => r.includes("re-check"));
})());

// 6. The clean path is allowed.
check("clean intent allowed", (() => {
  const d = canCreateIntent(base());
  return d.allowed && d.reasons.length === 0;
})());

// 7. State machine transitions.
check("pending -> approved -> executed", canTransition("PENDING_APPROVAL", "APPROVED") && canTransition("APPROVED", "EXECUTED"));
check("pending -> rejected", canTransition("PENDING_APPROVAL", "REJECTED"));
check("approved -> rejected", canTransition("APPROVED", "REJECTED"));
check("invalid transitions rejected", (() => {
  return !canTransition("EXECUTED", "APPROVED")
    && !canTransition("REJECTED", "APPROVED")
    && !canTransition("APPROVED", "PENDING_APPROVAL")
    && !canTransition("EXECUTED", "REJECTED")
    && !canTransition("PENDING_APPROVAL", "EXECUTED");
})());

// 8. Audit entry builder.
check("audit entry shape", (() => {
  const a = buildAuditEntry("pi_x", "intent.created", "user_1", null, new Date("2026-10-10T00:00:00Z"));
  return a.purchaseId === "pi_x" && a.action === "intent.created" && a.actor === "user_1"
    && a.reason === null && a.createdAt === "2026-10-10T00:00:00.000Z";
})());

// 9. Env parsing for caps and kill switch.
check("capsFromEnv defaults", (() => {
  const c = capsFromEnv({});
  return c.dailySpendCap === 2500 && c.perOrderCap === 1500 && c.maxUnitsPerAsin === 20;
})());
check("capsFromEnv overrides", (() => {
  const c = capsFromEnv({ NEXARB_DAILY_SPEND_CAP: "1000", NEXARB_PER_ORDER_CAP: "100", NEXARB_MAX_UNITS_PER_ASIN: "5" });
  return c.dailySpendCap === 1000 && c.perOrderCap === 100 && c.maxUnitsPerAsin === 5;
})());
check("killSwitchFromEnv", killSwitchFromEnv({ NEXARB_PURCHASE_KILL_SWITCH: "1" }) && !killSwitchFromEnv({}));

// 10. In-memory store: create, transition, invalid transition, usage tally.
check("store create -> approve -> invalid reject of executed", (() => {
  const s = new InMemoryPurchaseStore();
  const rec = s.createIntent({ asin: "B012345678", qty: 5, unitPrice: 20, verdict: "BUY", eligibility: "SELLABLE", createdBy: "u1" });
  if (rec.status !== "PENDING_APPROVAL") return false;
  const ap = s.transition(rec.id, "APPROVED", "u2", "looks good");
  if (!ap || ap.status !== "APPROVED" || ap.decidedBy !== "u2") return false;
  const ex = s.transition(rec.id, "EXECUTED", "u2", null);
  if (!ex || ex.status !== "EXECUTED") return false;
  return s.transition(rec.id, "REJECTED", "u2", null) === undefined; // terminal
})());
check("store usage tallies non-rejected spend", (() => {
  const s = new InMemoryPurchaseStore();
  const a = s.createIntent({ asin: "B012345678", qty: 5, unitPrice: 20, verdict: "BUY", eligibility: "SELLABLE", createdBy: "u1" });
  s.createIntent({ asin: "B012345678", qty: 3, unitPrice: 10, verdict: "BUY", eligibility: "SELLABLE", createdBy: "u1" });
  const b = s.createIntent({ asin: "B099999999", qty: 2, unitPrice: 50, verdict: "BUY", eligibility: "SELLABLE", createdBy: "u1" });
  s.transition(b.id, "REJECTED", "u2", "no");
  const u = s.usageFor("B012345678", new Date("2000-01-01T00:00:00Z"));
  return u.spentToday === 130 && u.unitsForAsinToday === 8; // rejected $100 excluded
})());
check("store transition on unknown id -> undefined", new InMemoryPurchaseStore().transition("nope", "APPROVED", "u", null) === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
