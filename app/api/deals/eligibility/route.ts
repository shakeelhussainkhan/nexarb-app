import { NextRequest, NextResponse } from "next/server";
import {
  checkEligibility,
  spApiConfigFromEnv,
  EligibilityCache,
} from "@/lib/engine/eligibility";

// Per-process cache (24h clean / 3h restricted; UNKNOWN never cached).
const cache = new EligibilityCache();

// GET /api/deals/eligibility?asin=B0XXXXXXXX
// Returns the four-state eligibility result for the configured seller account.
// Until AMAZON_SPAPI_* env vars exist, state is UNKNOWN with the reason —
// never a default SELLABLE.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const asin = req.nextUrl.searchParams.get("asin")?.trim().toUpperCase();
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ error: "Valid 10-character asin required" }, { status: 400 });
  }
  const cfg = spApiConfigFromEnv(process.env);
  const result = await checkEligibility(cfg, asin, cache);
  return NextResponse.json({ asin, ...result });
}
