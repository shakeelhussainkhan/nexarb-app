import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { priceMatchedPetraOffers } from "@/lib/suppliers/petra";

// POST /api/sourcing/petra/scan
//
// Bounded pricing pass: for Petra offers already matched to an ASIN but
// not yet priced, fetch the live Amazon landed price (same SP-API pricing
// client the verification scan uses) and store it with the ESTIMATED
// net/margin from lib/suppliers/petraCore.ts (fee stack mirrors
// lib/engine/pricing.ts + $1.50/unit 3PL prep — estimates, never exact).
// Offers whose price lookup is unknown stay unpriced for a later pass.
//
// Body (optional): { cap } — default 25, hard-capped at 50 in the lib
// (each attempt costs two throttled SP-API calls; larger batches timed
// out before returning — see lib/suppliers/pricingCore.ts).
// Auth: Clerk session OR personal API key (X-NexArb-Key).
// PRICING ONLY — reads prices and stores estimates; buys nothing.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { success: false, error: "Supabase is not configured." },
        { status: 503 }
      );
    }

    let cap = 25;
    try {
      const body = (await req.json()) as { cap?: unknown };
      if (typeof body?.cap === "number" && Number.isFinite(body.cap)) {
        cap = Math.trunc(body.cap);
      }
    } catch {
      // Empty body is fine — defaults apply.
    }

    const result = await priceMatchedPetraOffers(cap);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Supplier pricing failed." },
      { status: 500 }
    );
  }
}
