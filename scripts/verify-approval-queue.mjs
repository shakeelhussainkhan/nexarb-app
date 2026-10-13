// Offline harness for the approval queue
// (lib/engine/approvalQueueCore.ts + formatApprovalAlertMessage).
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-approval-queue.mjs
// Pure-logic tests — NO network, NO database.
import {
  MIN_APPROVAL_MARGIN_PCT,
  pickBestChannel,
  evaluateApprovalCandidate,
  decideQueueAction,
  rankApprovalQueue,
} from "@/lib/engine/approvalQueueCore.ts";
import { formatApprovalAlertMessage } from "@/lib/telegram/alerts.ts";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

function channel(name, netProfit, marginPct) {
  return {
    channel: name,
    sellPrice: 100,
    sellPriceSource: "test",
    floorPrice: 50,
    netProfit,
    marginPct,
    verdict: "UNKNOWN",
    reasons: [],
  };
}

const LINKS = ["https://sellercentral.amazon.com/approval/xyz"];
const GOOD = [channel("amazon-fba", 8.25, 41.5), channel("walmart-wfs", 5.0, 30.0)];

// --- pickBestChannel ---
check("best channel = highest net/unit",
  pickBestChannel(GOOD)?.channel === "amazon-fba");
check("best channel of empty = null", pickBestChannel([]) === null);

// --- evaluateApprovalCandidate ---
{
  const base = {
    asin: "B0TEST111",
    approvalLinks: LINKS,
    channels: GOOD,
    buyPrice: 40,
    sellPrice: 100,
  };
  const ok = evaluateApprovalCandidate({ ...base, eligibilityState: "APPROVAL_REQUIRED" });
  check("gated + profitable + margin over bar -> candidate",
    ok.candidate?.asin === "B0TEST111" && ok.candidate?.netPerUnit === 8.25 && ok.candidate?.approvalUrl === LINKS[0],
    JSON.stringify(ok));

  check("not gated -> no candidate",
    evaluateApprovalCandidate({ ...base, eligibilityState: "SELLABLE" }).candidate === null);
  check("gated but no approval link -> no candidate",
    evaluateApprovalCandidate({ ...base, eligibilityState: "APPROVAL_REQUIRED", approvalLinks: [] }).candidate === null);
  check("gated but losing money -> no candidate",
    evaluateApprovalCandidate({ ...base, eligibilityState: "APPROVAL_REQUIRED", channels: [channel("amazon-fba", -6.01, -100.6)] }).candidate === null);
  const thin = evaluateApprovalCandidate({
    ...base,
    eligibilityState: "APPROVAL_REQUIRED",
    channels: [channel("amazon-fba", 4.0, MIN_APPROVAL_MARGIN_PCT - 5)],
  });
  check("gated + profitable but margin under 25% -> no candidate",
    thin.candidate === null && thin.reason.includes("below"), JSON.stringify(thin));
  const edge = evaluateApprovalCandidate({
    ...base,
    eligibilityState: "APPROVAL_REQUIRED",
    channels: [channel("amazon-fba", 4.0, MIN_APPROVAL_MARGIN_PCT)],
  });
  check("margin exactly at the bar -> candidate", edge.candidate !== null);
  check("first non-blank link wins",
    evaluateApprovalCandidate({ ...base, eligibilityState: "APPROVAL_REQUIRED", approvalLinks: ["", "  ", LINKS[0]] }).candidate?.approvalUrl === LINKS[0]);
}

// --- decideQueueAction ---
check("no row -> insert + alert",
  (() => { const a = decideQueueAction(null); return a.write === "insert" && a.shouldAlert; })());
check("pending + alerted -> refresh, no re-alert",
  (() => { const a = decideQueueAction({ status: "pending", alertedAt: "2026-10-13T00:00:00Z" }); return a.write === "refresh" && !a.shouldAlert; })());
check("pending + never alerted -> refresh + alert (retry)",
  (() => { const a = decideQueueAction({ status: "pending", alertedAt: null }); return a.write === "refresh" && a.shouldAlert; })());
check("applied -> scans never touch",
  decideQueueAction({ status: "applied", alertedAt: "2026-10-13T00:00:00Z" }).write === "none");
check("dismissed -> scans never resurrect",
  decideQueueAction({ status: "dismissed", alertedAt: null }).write === "none");

// --- rankApprovalQueue ---
{
  const rows = [
    { asin: "A1", approvalUrl: "u", channel: "c", netPerUnit: 9, marginPct: 30, buyPrice: 1, sellPrice: 2, status: "dismissed" },
    { asin: "A2", approvalUrl: "u", channel: "c", netPerUnit: 5, marginPct: 28, buyPrice: 1, sellPrice: 2, status: "pending" },
    { asin: "A3", approvalUrl: "u", channel: "c", netPerUnit: 7, marginPct: 44, buyPrice: 1, sellPrice: 2, status: "pending" },
    { asin: "A4", approvalUrl: "u", channel: "c", netPerUnit: 20, marginPct: 60, buyPrice: 1, sellPrice: 2, status: "applied" },
  ];
  const ranked = rankApprovalQueue(rows).map((r) => r.asin).join(",");
  check("rank: pending first by margin, then applied, then dismissed",
    ranked === "A3,A2,A4,A1", ranked);
}

// --- alert message ---
{
  const msg = formatApprovalAlertMessage({
    asin: "B0TEST111",
    title: "Acme <b>Widget</b> 12 Count",
    channel: "amazon-fba",
    netPerUnit: 8.25,
    marginPct: 41.5,
    buyPrice: 40,
    sellPrice: 100,
    approvalUrl: LINKS[0],
  });
  check("alert message carries economics + link",
    msg.includes("$8.25") && msg.includes("41.5%") && msg.includes(LINKS[0]) && msg.includes("B0TEST111"));
  check("alert message escapes HTML in title",
    msg.includes("&lt;b&gt;") && !msg.includes("<b>Widget"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
