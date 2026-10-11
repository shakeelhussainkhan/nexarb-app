import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";

// GET /api/activity — first-party activity feed.
// Surfaces recent deal checks and purchase-intent decisions, newest first.
export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json([]);
  }

  try {
    const admin = getSupabaseAdmin();
    const [{ data: checks }, { data: intents }] = await Promise.all([
      admin
        .from("deal_checks")
        .select("asin, verdict, eligibility, checked_at")
        .order("checked_at", { ascending: false })
        .limit(10),
      admin
        .from("purchases")
        .select("asin, status, created_at, decided_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const events: Array<{ type: string; asin: string; detail: string; at: string }> = [];
    for (const c of (checks ?? []) as Array<{
      asin: string;
      verdict: string;
      eligibility: string;
      checked_at: string;
    }>) {
      events.push({
        type: c.verdict === "BUY" ? "routing_decision" : "product_rejected",
        asin: c.asin,
        detail: `Deal check: verdict ${c.verdict}, eligibility ${c.eligibility}`,
        at: c.checked_at,
      });
    }
    for (const p of (intents ?? []) as Array<{
      asin: string;
      status: string;
      created_at: string;
      decided_at: string | null;
    }>) {
      events.push({
        type: "routing_decision",
        asin: p.asin,
        detail: `Purchase intent ${p.status}`,
        at: p.decided_at ?? p.created_at,
      });
    }
    events.sort((a, b) => (a.at < b.at ? 1 : -1));
    return NextResponse.json(events.slice(0, 20));
  } catch {
    return NextResponse.json([]);
  }
}
