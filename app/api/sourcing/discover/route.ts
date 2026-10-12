import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { ingestCandidates } from "@/lib/sourcing/ingest";
import { MAX_CANDIDATES_PER_INGEST } from "@/lib/sourcing/orchestrate";
import type { BrowserCandidate } from "@/lib/sourcing/ingest";

// POST /api/sourcing/discover
//
// Accepts product candidates discovered via the live browser session (which
// passes retailer bot checks that block datacenter IPs), matches each UPC to
// an Amazon ASIN via SP-API, and inserts NEW matches into `watchlist`.
//
// Body: { candidates: [{ title, price, url, upc, retailer }] }
// The browser task runs in the user's authenticated session, so this stays
// Clerk-gated like every other endpoint.
//
// DISCOVERY ONLY — nothing here purchases, creates intents, or spends money.
// The handler never throws: every failure path returns JSON.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { success: false, error: "Supabase is not configured — nowhere to store discovery results." },
        { status: 503 }
      );
    }

    let body: { candidates?: BrowserCandidate[] };
    try {
      body = (await req.json()) as { candidates?: BrowserCandidate[] };
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (candidates.length === 0) {
      return NextResponse.json({ success: true, received: 0, matched: 0, added: 0, errors: [] });
    }
    if (candidates.length > MAX_CANDIDATES_PER_INGEST) {
      return NextResponse.json(
        { success: false, error: `Too many candidates (max ${MAX_CANDIDATES_PER_INGEST} per call).` },
        { status: 400 }
      );
    }

    const retailer = candidates[0]?.retailer?.trim() || "browser";
    const result = await ingestCandidates(candidates, `${retailer}-discovery`);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Discovery ingest failed." },
      { status: 500 }
    );
  }
}
