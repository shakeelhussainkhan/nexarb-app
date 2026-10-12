// Offline harness for the assisted-checkout state machine + URL plumbing.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-checkout.mjs
// Pure-logic tests — NO network, NO database.
import {
  isCheckoutStatus,
  validateCheckoutRequest,
  validateCheckoutTransition,
} from "@/lib/engine/checkout.ts";
import { buildWatchlistPayload } from "@/lib/sourcing/orchestrate.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// --- checkout status validation -------------------------------------------
check("isCheckoutStatus('requested')", isCheckoutStatus("requested"));
check("isCheckoutStatus('bogus') false", !isCheckoutStatus("bogus"));
check("isCheckoutStatus(null) false", !isCheckoutStatus(null));

// --- request validation ----------------------------------------------------
check(
  "request allowed: APPROVED + none",
  validateCheckoutRequest("APPROVED", "none").ok
);
check(
  "request allowed: APPROVED + failed (retry)",
  validateCheckoutRequest("APPROVED", "failed").ok
);
check(
  "request rejected: PENDING_APPROVAL",
  !validateCheckoutRequest("PENDING_APPROVAL", "none").ok
);
check(
  "request rejected: REJECTED",
  !validateCheckoutRequest("REJECTED", "none").ok
);
check(
  "request rejected: EXECUTED",
  !validateCheckoutRequest("EXECUTED", "none").ok
);
check(
  "request rejected: APPROVED + already requested",
  !validateCheckoutRequest("APPROVED", "requested").ok
);
check(
  "request rejected: APPROVED + awaiting_payment",
  !validateCheckoutRequest("APPROVED", "awaiting_payment").ok
);
check(
  "request rejected: APPROVED + completed",
  !validateCheckoutRequest("APPROVED", "completed").ok
);

// --- transition validation -------------------------------------------------
check(
  "none -> requested",
  validateCheckoutTransition("none", "requested").ok
);
check(
  "requested -> in_progress",
  validateCheckoutTransition("requested", "in_progress").ok
);
check(
  "in_progress -> awaiting_payment",
  validateCheckoutTransition("in_progress", "awaiting_payment").ok
);
check(
  "awaiting_payment -> completed",
  validateCheckoutTransition("awaiting_payment", "completed").ok
);
check(
  "requested -> failed",
  validateCheckoutTransition("requested", "failed").ok
);
check(
  "in_progress -> failed",
  validateCheckoutTransition("in_progress", "failed").ok
);
check(
  "failed -> requested (retry)",
  validateCheckoutTransition("failed", "requested").ok
);
check(
  "none -> completed rejected",
  !validateCheckoutTransition("none", "completed").ok
);
check(
  "completed -> requested rejected (terminal)",
  !validateCheckoutTransition("completed", "requested").ok
);
check(
  "awaiting_payment -> in_progress rejected (no backward)",
  !validateCheckoutTransition("awaiting_payment", "in_progress").ok
);
check(
  "bogus target rejected",
  !validateCheckoutTransition("none", "shipped").ok
);
check(
  "null current treated as none",
  validateCheckoutTransition(null, "requested").ok
);

// --- retailer_url passthrough into watchlist -------------------------------
const rows = buildWatchlistPayload(
  [{ asin: "B001234567", title: "Widget", buyPrice: 5.0, sourceUrl: "https://www.walmart.com/ip/123" }],
  []
);
check("source_url carried into watchlist row", rows[0].source_url === "https://www.walmart.com/ip/123");

const rowsNoUrl = buildWatchlistPayload(
  [{ asin: "B001234568", title: "Gadget", buyPrice: 6.0 }],
  []
);
check("source_url null when not supplied", rowsNoUrl[0].source_url === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
