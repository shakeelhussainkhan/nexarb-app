import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// PATCH /api/compliance/shipments/[id] — session-only updates: status
// pipeline, entry number, ISF data and the ISF-filed stamp. This is how
// a filed/released state gets recorded once the broker confirms it.

const STATUSES = [
  "planning", "isf_due", "isf_filed", "in_transit",
  "entry_filed", "released", "delivered", "cancelled",
] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await ctx.params;
  let body: {
    status?: string;
    entryNumber?: string;
    eta?: string;
    etd?: string;
    isfData?: Record<string, string>;
    markIsfFiled?: boolean;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ success: false, error: `status must be one of ${STATUSES.join(", ")}.` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.entryNumber !== undefined) patch.entry_number = body.entryNumber;
  if (body.eta !== undefined) patch.eta = body.eta;
  if (body.etd !== undefined) patch.etd = body.etd;
  if (body.isfData !== undefined) patch.isf_data = body.isfData;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.markIsfFiled) {
    patch.isf_filed_at = new Date().toISOString();
    patch.status = "isf_filed";
  }
  const { data, error } = await getSupabaseAdmin()
    .from("import_shipments")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, shipment: data });
}
