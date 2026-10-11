// Source-trust assessment for buy sources.
// Pure function: maps a buy_source string to a coarse trust level plus
// advisory notes. Pure assessment ONLY — it never blocks a purchase; all
// purchase gating lives in lib/engine/guards.ts and lib/engine/verdict.ts.
// Never throws: any unexpected input degrades to "unverified".

export type TrustLevel = "verified-retailer" | "unverified";

export interface TrustAssessment {
  level: TrustLevel;
  notes: string[];
}

// Known first-party retail domains. Goods bought at retail from these
// merchants are genuine by first sale; the receipt is the proof.
const RETAIL_DOMAINS = [
  "walmart.com",
  "target.com",
  "costco.com",
  "amazon.com",
  "bestbuy.com",
  "homedepot.com",
  "lowes.com",
];

const VERIFIED_NOTE =
  "Sourced from authorized retail — genuine by definition; keep receipt";

const UNVERIFIED_NOTES = [
  "Require supplier invoice",
  "Verify authorized distributor status",
  "Inspect on receipt before FBA inbound",
];

// Extract host-like tokens from an arbitrary source string (plain domain,
// full URL, or freeform text like "Walmart clearance aisle").
function extractHosts(input: string): string[] {
  const matches = input.match(
    /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/g
  );
  return matches ?? [];
}

// Domain-boundary match: host equals the retail domain or is a real
// subdomain of it ("www.walmart.com" ✓, "fake-walmart.com" ✗ — substring
// matching alone would wrongly verify the latter).
function isRetailHost(host: string): boolean {
  return RETAIL_DOMAINS.some(
    (d) => host === d || host.endsWith("." + d)
  );
}

export function assessTrust(buySource: string): TrustAssessment {
  try {
    const raw = typeof buySource === "string" ? buySource : "";
    const normalized = raw.trim().toLowerCase();
    if (normalized === "") {
      return { level: "unverified", notes: [...UNVERIFIED_NOTES] };
    }
    const hosts = extractHosts(normalized);
    if (hosts.some(isRetailHost)) {
      return { level: "verified-retailer", notes: [VERIFIED_NOTE] };
    }
    return { level: "unverified", notes: [...UNVERIFIED_NOTES] };
  } catch {
    // Assessment must never break a check.
    return { level: "unverified", notes: [...UNVERIFIED_NOTES] };
  }
}
