import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { matchPendingPetraOffers } from "@/lib/suppliers/petra";

// POST /api/sourcing/petra/match
//
// Bounded, resumable matching pass: takes Petra offers still awaiting an
// ASIN (match_status pending, or error from a transient API failure) and
// resolves each UPC via the same SP-API Catalog Items matcher discovery
// ingest uses, paced through the shared throttle. Idempotent — matched
// and no_match rows are never re-looked-up.
//
// Body (optional): { limit } — default 50, hard-capped in the lib.
// Auth: Clerk session OR personal API key (X-NexArb-Key).
// MATCHING ONLY — reads the Amazon catalog; creates nothing, buys nothing.
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

    let limit = 50;
    try {
      const body = (await req.json()) as { limit?: unknown };
      if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.trunc(body.limit);
      }
    } catch {
      // Empty body is fine — defaults apply.
    }

    const result = await matchPendingPetraOffers(limit);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Supplier matching failed." },
      { status: 500 }
    );
  }
}
