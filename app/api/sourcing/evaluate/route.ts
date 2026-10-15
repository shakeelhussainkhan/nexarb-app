import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { evaluateSupplierOffers } from "@/lib/suppliers/evaluate";

// POST /api/sourcing/evaluate
//
// Bounded, resumable evaluation pass: for supplier offers that are matched
// to an ASIN and priced but not yet evaluated, fetch the live signals the
// ingest pipeline does not store (sales rank via SP-API Catalog Items,
// eligibility via SP-API Listings Restrictions — paced through the shared
// throttle), run the pure verdict core (freight-aware economics, BSR-model
// velocity, Q4 seasonal boost), and persist verdict/score/reasons on the
// offer row. Fresh evaluations are skipped; stale ones (>24h) refresh only
// with ?refresh=true.
//
// Query params: ?supplier=petra|frontier (omit = all suppliers),
//               ?refresh=true
// Body (optional): { limit } — default 100, hard-capped in the lib.
// Auth: Clerk session OR personal API key (X-NexArb-Key) — cron-friendly,
// exactly like the match/pricing passes.
// EVALUATION ONLY — reads live signals and stores verdicts; promotes
// nothing, creates no intents, buys nothing.
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

    const url = new URL(req.url);
    const supplierParam = (url.searchParams.get("supplier") ?? "").trim();
    const supplier = supplierParam ? supplierParam : null;
    const refresh = url.searchParams.get("refresh") === "true";

    let limit = 100;
    try {
      const body = (await req.json()) as { limit?: unknown };
      if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.trunc(body.limit);
      }
    } catch {
      // Empty body is fine — defaults apply.
    }

    const result = await evaluateSupplierOffers({ supplier, limit, refresh });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Supplier evaluation failed." },
      { status: 500 }
    );
  }
}
