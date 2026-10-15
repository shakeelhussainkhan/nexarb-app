import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { promoteOffersToWatchlist, PROMOTE_MAX_PER_CALL } from "@/lib/suppliers/promote";

// POST /api/suppliers/promote
//
// Promote evaluated supplier offers (verdict "candidate" only) onto the
// watchlist, where the existing scan → verdict → approval-queue →
// guarded-intent machinery takes over unchanged. ASINs already on the
// watchlist are skipped (never duplicated) and reported.
//
// Body: { offerIds: string[] } — max PROMOTE_MAX_PER_CALL per call.
// Auth: SESSION ONLY. Promotion is a deliberate human decision in the
// dashboard (same rule as approval-queue decisions): an API key gets 403.
// This route is deliberately NOT in the proxy's API-key bypass list — the
// middleware session-gates it, and the handler re-checks the identity.
// Promotion buys nothing and creates no purchase intents.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (identity.via === "api-key") {
      return NextResponse.json(
        { error: "Promotion requires a signed-in session — API keys cannot promote offers." },
        { status: 403 }
      );
    }

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { success: false, error: "Supabase is not configured." },
        { status: 503 }
      );
    }

    let body: { offerIds?: unknown };
    try {
      body = (await req.json()) as { offerIds?: unknown };
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }
    const offerIds = Array.isArray(body.offerIds)
      ? body.offerIds.filter((v): v is string => typeof v === "string")
      : [];
    if (offerIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "Body must be { offerIds: string[] } with at least one id." },
        { status: 400 }
      );
    }
    if (offerIds.length > PROMOTE_MAX_PER_CALL) {
      return NextResponse.json(
        { success: false, error: `Too many offers (max ${PROMOTE_MAX_PER_CALL} per call).` },
        { status: 400 }
      );
    }

    const result = await promoteOffersToWatchlist(offerIds);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Promotion failed." },
      { status: 500 }
    );
  }
}
