import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { appendExternalMilestone } from "@/lib/lifecycle/external";
import type { StageEntry } from "@/lib/lifecycle/core";

// POST /api/orders/external/[id]/milestones — append ONE milestone to
// an external order's journey. Clerk session OR personal API key
// (X-NexArb-Key) via resolveUser — this is the write path automation
// uses as evidence arrives: the Petra email watch appends `shipped`
// when the tracking email lands and `at_warehouse` when the 3PL
// confirms receipt, so the Orders board advances without the founder
// touching the record. Milestones are append-only evidence; history is
// never rewritten.
//
// Body: { stage, source, at?, detail? }
//   stage  — required; must be a canonical lifecycle stage. The
//            vocabulary check lives in appendExternalMilestone
//            (lib/lifecycle/external.ts → isCanonicalStage); its
//            "Unknown lifecycle stage: …" error is surfaced verbatim
//            as a 422.
//   source — required, non-empty: which record evidences the stage
//            (e.g. "petra tracking email 2026-10-16"). Stored verbatim.
//   at     — optional ISO timestamp of when the stage was reached;
//            defaults to now. An unparseable value is a 400.
//   detail — optional free-text note, stored verbatim.
// The order's status mirror moves to the appended stage (writers
// append in chronological order — confirmations before tracking
// before delivery — so the latest milestone is the furthest stage).
// Response: 200 { order } — the updated record. 404 for an unknown id
// (including an id owned by a different user).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { error: "Supabase is not configured in this environment, so milestones cannot be recorded." },
        { status: 503 }
      );
    }
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "External order id required." }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const stage = typeof body.stage === "string" ? body.stage.trim() : "";
    const source = typeof body.source === "string" ? body.source.trim() : "";
    const problems: string[] = [];
    if (!stage) problems.push("stage is required (a canonical lifecycle stage).");
    if (!source) problems.push("source is required (which record evidences this stage).");

    let at = new Date().toISOString();
    if (body.at !== undefined && body.at !== null && body.at !== "") {
      const parsed = new Date(String(body.at));
      if (Number.isNaN(parsed.getTime())) {
        problems.push("at must be a valid ISO timestamp when given.");
      } else {
        at = parsed.toISOString();
      }
    }
    let detail: string | undefined;
    if (body.detail !== undefined && body.detail !== null && body.detail !== "") {
      if (typeof body.detail !== "string") problems.push("detail must be a string when given.");
      else detail = body.detail;
    }

    if (problems.length > 0) {
      return NextResponse.json({ error: "Invalid milestone", reasons: problems }, { status: 400 });
    }

    const milestone: StageEntry = {
      stage: stage as StageEntry["stage"],
      at,
      source,
      ...(detail !== undefined ? { detail } : {}),
    };

    let order;
    try {
      order = await appendExternalMilestone(getSupabaseAdmin(), identity.userId, id, milestone, stage);
    } catch (e) {
      // The helper's canonical-stage rejection is a client error, and
      // its message is the contract — surface it verbatim as a 422.
      if (e instanceof Error && e.message.startsWith("Unknown lifecycle stage:")) {
        return NextResponse.json({ error: e.message }, { status: 422 });
      }
      throw e;
    }
    if (!order) {
      return NextResponse.json({ error: "External order not found." }, { status: 404 });
    }
    return NextResponse.json({ order }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not append the milestone." },
      { status: 500 }
    );
  }
}
