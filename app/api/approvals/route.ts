import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  rankApprovalQueue,
  type ApprovalStatus,
} from "@/lib/engine/approvalQueueCore";

// GET /api/approvals — the approval queue: products that are profitable
// but gated behind an Amazon brand approval, ranked by margin. Readable
// with a Clerk session OR a personal API key (same as purchases list).
//
// POST /api/approvals — founder decisions only: { asin, action } with
// action "applied" | "dismissed" | "pending" (reopen). Session-only —
// API keys get 403, matching the rule that queueing human decisions is
// never a machine action. Scans never overwrite these decisions.

interface QueueRow {
  asin: string;
  title: string | null;
  approval_url: string;
  channel: string;
  net_per_unit: number | string;
  margin_pct: number | string;
  buy_price: number | string | null;
  sell_price: number | string | null;
  status: ApprovalStatus;
  first_seen_at: string;
  last_seen_at: string;
  alerted_at: string | null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("approval_queue")
      .select("asin, title, approval_url, channel, net_per_unit, margin_pct, buy_price, sell_price, status, first_seen_at, last_seen_at, alerted_at")
      .limit(200);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    const rows = ((data ?? []) as QueueRow[]).map((r) => ({
      asin: r.asin,
      title: r.title,
      approvalUrl: r.approval_url,
      channel: r.channel,
      netPerUnit: Number(r.net_per_unit),
      marginPct: Number(r.margin_pct),
      buyPrice: r.buy_price === null ? null : Number(r.buy_price),
      sellPrice: r.sell_price === null ? null : Number(r.sell_price),
      status: r.status,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      alertedAt: r.alerted_at,
    }));
    return NextResponse.json({ success: true, approvals: rankApprovalQueue(rows) });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Could not read the approval queue." },
      { status: 500 }
    );
  }
}

const ACTION_TO_STATUS: Record<string, ApprovalStatus> = {
  applied: "applied",
  dismissed: "dismissed",
  pending: "pending",
};

export async function POST(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (identity.via === "api-key") {
    return NextResponse.json(
      { error: "Approval decisions require a signed-in session — API keys cannot mark applications." },
      { status: 403 }
    );
  }

  if (!supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
  }

  let body: { asin?: string; action?: string };
  try {
    body = (await req.json()) as { asin?: string; action?: string };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const asin = (body.asin ?? "").trim();
  const status = ACTION_TO_STATUS[(body.action ?? "").trim()];
  if (!asin || !status) {
    return NextResponse.json(
      { success: false, error: "Body must be { asin, action: 'applied' | 'dismissed' | 'pending' }." },
      { status: 400 }
    );
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("approval_queue")
      .update({ status })
      .eq("asin", asin)
      .select("asin")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: `No queue entry for ASIN ${asin}.` }, { status: 404 });
    }
    return NextResponse.json({ success: true, asin, status });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Could not update the approval queue." },
      { status: 500 }
    );
  }
}
