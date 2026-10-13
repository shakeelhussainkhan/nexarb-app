import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { estimateDuties, type DutyInput } from "@/lib/compliance/core";

// /api/compliance/shipments — inbound import shipments.
// GET (session or API key): list shipments (the compliance monitor cron
// reads deadlines through the key).
// POST (session only): create a shipment; a duty estimate is computed
// server-side from the declared value/origin/rates and stored with it.

export async function GET(req: NextRequest) {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("import_shipments")
    .select("*")
    .eq("user_id", identity.userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, shipments: data ?? [] });
}

export async function POST(req: NextRequest) {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity" || identity.via !== "session") {
    return NextResponse.json(
      { success: false, error: "Creating shipments requires a signed-in session." },
      { status: 403 }
    );
  }
  let body: {
    name?: string;
    supplierName?: string;
    originCountry?: string;
    originPort?: string;
    destPort?: string;
    transport?: string;
    etd?: string;
    eta?: string;
    brokerName?: string;
    customsValue?: number;
    duty?: Partial<DutyInput>;
    isfData?: Record<string, string>;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ success: false, error: "name is required." }, { status: 400 });

  const originCountry = (body.originCountry ?? "CN").toUpperCase();
  const customsValue = Number(body.customsValue ?? 0) || 0;
  const dutyEstimate = estimateDuties({
    customsValue,
    originCountry,
    mfnRate: Number(body.duty?.mfnRate ?? 0) || 0,
    section301List: body.duty?.section301List,
    section232: body.duty?.section232 ?? null,
    adcvdRate: Number(body.duty?.adcvdRate ?? 0) || 0,
    ocean: (body.transport ?? "ocean") === "ocean",
  });

  const { data, error } = await getSupabaseAdmin()
    .from("import_shipments")
    .insert({
      user_id: identity.userId,
      name,
      supplier_name: body.supplierName ?? null,
      origin_country: originCountry,
      origin_port: body.originPort ?? null,
      dest_port: body.destPort ?? null,
      transport: body.transport ?? "ocean",
      etd: body.etd ?? null,
      eta: body.eta ?? null,
      broker_name: body.brokerName ?? null,
      customs_value: customsValue,
      duty_estimate: dutyEstimate,
      isf_data: body.isfData ?? {},
      notes: body.notes ?? null,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, shipment: data });
}
