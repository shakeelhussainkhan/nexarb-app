// Offline harness for the source-trust assessment.
// Run: node scripts/verify-ws5-trust.mjs
import { assessTrust } from "../lib/engine/trust.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

// ── Every retail domain → verified-retailer ──────────────────────────────
const RETAIL = [
  "walmart.com",
  "target.com",
  "costco.com",
  "amazon.com",
  "bestbuy.com",
  "homedepot.com",
  "lowes.com",
];
for (const d of RETAIL) {
  const r = assessTrust(d);
  check(`${d} → verified-retailer`, r.level === "verified-retailer", JSON.stringify(r));
}

// Case-insensitive.
check("Walmart.com (upper) → verified-retailer",
  assessTrust("Walmart.com").level === "verified-retailer");

// Real subdomains of a retail domain → still verified.
check("www.walmart.com → verified-retailer",
  assessTrust("www.walmart.com").level === "verified-retailer");
check("full URL https://www.walmart.com/ip/123 → verified-retailer",
  assessTrust("https://www.walmart.com/ip/123").level === "verified-retailer");

// ── Domain-boundary attacks → must be UNVERIFIED ─────────────────────────
check("fake-walmart.com → unverified (domain boundary)",
  assessTrust("fake-walmart.com").level === "unverified");
check("walmart.com.evil.com → unverified (suffix trick)",
  assessTrust("walmart.com.evil.com").level === "unverified");
check("www.fake-walmart.com → unverified",
  assessTrust("www.fake-walmart.com").level === "unverified");
check("eviltarget.com → unverified",
  assessTrust("eviltarget.com").level === "unverified");

// ── Marketplace / wholesale / unknown → unverified ───────────────────────
for (const s of ["alibaba.com", "random supplier", "eBay seller xyz", "founder-supplied", "Manual"]) {
  const r = assessTrust(s);
  check(`"${s}" → unverified`, r.level === "unverified", JSON.stringify(r));
}

// ── Empty / missing → unverified, never throws ───────────────────────────
check("empty string → unverified",
  assessTrust("").level === "unverified");
check("null → unverified",
  assessTrust(null).level === "unverified");
check("undefined → unverified",
  assessTrust(undefined).level === "unverified");
check("number input → unverified (no throw)",
  assessTrust(123).level === "unverified");

// ── Notes shape ──────────────────────────────────────────────────────────
check("verified notes non-empty with receipt guidance",
  assessTrust("walmart.com").notes.length > 0 &&
  /receipt/i.test(assessTrust("walmart.com").notes.join(" ")));
check("unverified notes contain supplier-invoice checklist",
  /supplier invoice/i.test(assessTrust("alibaba.com").notes.join("; ")) &&
  /authorized distributor/i.test(assessTrust("alibaba.com").notes.join("; ")) &&
  /inspect/i.test(assessTrust("alibaba.com").notes.join("; ")));

// Only allowed levels ever returned.
for (const s of ["walmart.com", "alibaba.com", "", "fake-walmart.com"]) {
  const l = assessTrust(s).level;
  check(`level is a valid enum value ("${s}")`,
    l === "verified-retailer" || l === "unverified", `got "${l}"`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
