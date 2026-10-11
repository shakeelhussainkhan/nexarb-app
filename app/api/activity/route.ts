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
    const [{ data: checks }, { data: intents }, { data: watched }] = await Promise.all([
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
      admin.from("watchlist").select("asin, title"),
    ]);
    const titles = new Map(
      ((watched ?? []) as Array<{ asin: string; title: string }>).map((w) => [w.asin, w.title])
    );

    const events: Array<{
      type: string;
      data: { asin: string; title?: string };
      timestamp: string;
    }> = [];
    for (const c of (checks ?? []) as Array<{
      asin: string;
      verdict: string;
      eligibility: string;
      checked_at: string;
    }>) {
      events.push({
        type: c.verdict === "BUY" ? "routing_decision" : "product_rejected",
        data: { asin: c.asin, title: titles.get(c.asin) },
        timestamp: c.checked_at,
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
        data: { asin: p.asin, title: titles.get(p.asin) },
        timestamp: p.decided_at ?? p.created_at,
      });
    }
    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return NextResponse.json(events.slice(0, 20));
  } catch {
    return NextResponse.json([]);
  }
}
