import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { assembleJourneys } from "@/lib/lifecycle/assemble";

// GET /api/orders/journeys
//
// The unified order-lifecycle view (PR-D1): every order Five S has in
// flight, from every source, expressed in the canonical stage
// vocabulary of lib/lifecycle/core.ts —
//   · alibaba_orders (+ their linked import_shipments, linked purchase
//     intents for approval stamps, and per-ASIN sales aggregates),
//   · purchases intents (retail journeys),
//   · external_orders (orders placed outside the app, migration 023).
//
// The assembly itself (including the retail inclusion rule) lives in
// lib/lifecycle/assemble.ts, shared with GET /api/dashboard/metrics.
//
// Auth: Clerk session OR personal API key (X-NexArb-Key) via
// resolveUser — same pattern as GET /api/purchases and the other
// cron-readable GETs (proxy.ts bypasses this exact path).
//
// Response: { journeys: OrderJourney[] } sorted exceptions-first,
// then by latest stage timestamp desc (lib/lifecycle/core sortJourneys).
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { error: "Supabase is not configured in this environment, so no journeys can be assembled." },
        { status: 503 }
      );
    }
    const journeys = await assembleJourneys(getSupabaseAdmin(), identity.userId);
    return NextResponse.json({ journeys });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not assemble order journeys." },
      { status: 500 }
    );
  }
}
