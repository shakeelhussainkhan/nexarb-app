import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// /api/compliance/documents — the compliance document register (the
// index of the importer's 5-year archive). Session only.
// GET: list. POST: add or update a document record.

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  const { data, error } = await getSupabaseAdmin()
    .from("compliance_documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, documents: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  let body: {
    id?: string;
    productComplianceId?: string;
    shipmentId?: string;
    docType?: string;
    title?: string;
    fileUrl?: string;
    issuer?: string;
    issuedAt?: string;
    expiresAt?: string;
    status?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ success: false, error: "title is required." }, { status: 400 });
  const admin = getSupabaseAdmin();
  const row = {
    user_id: userId,
    product_compliance_id: body.productComplianceId ?? null,
    shipment_id: body.shipmentId ?? null,
    doc_type: body.docType ?? "other",
    title,
    file_url: body.fileUrl ?? null,
    issuer: body.issuer ?? null,
    issued_at: body.issuedAt ?? null,
    expires_at: body.expiresAt ?? null,
    status: body.status ?? "on_file",
    updated_at: new Date().toISOString(),
  };
  if (body.id) {
    const { data, error } = await admin
      .from("compliance_documents")
      .update(row)
      .eq("id", body.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, document: data });
  }
  const { data, error } = await admin.from("compliance_documents").insert(row).select("*").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, document: data });
}
