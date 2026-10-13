import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { screenProduct } from "@/lib/compliance/core";

// /api/compliance/products — the per-product compliance register.
// GET (session): list the signed-in user's product compliance records.
// POST (session): create or update a product — screening is (re)run
// server-side so a stored verdict can never be hand-edited past the
// prohibited-goods/IP screen.

async function sessionUser(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

export async function GET() {
  const userId = await sessionUser();
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  const { data, error } = await getSupabaseAdmin()
    .from("product_compliance")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, products: data ?? [] });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUser();
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  let body: {
    id?: string;
    asin?: string;
    alibabaProductId?: string;
    title?: string;
    supplierName?: string;
    htsCode?: string;
    originCountry?: string;
    checklistStatus?: Record<string, string>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ success: false, error: "title is required." }, { status: 400 });

  const screening = screenProduct({ title, supplierName: body.supplierName ?? null });
  const admin = getSupabaseAdmin();
  const row = {
    user_id: userId,
    asin: body.asin ?? null,
    alibaba_product_id: body.alibabaProductId ?? null,
    title,
    supplier_name: body.supplierName ?? null,
    category: screening.category,
    hts_code: body.htsCode ?? null,
    origin_country: (body.originCountry ?? "CN").toUpperCase(),
    screening_verdict: screening.verdict,
    screening_reasons: screening.reasons,
    checklist_status: body.checklistStatus ?? {},
    updated_at: new Date().toISOString(),
  };

  if (body.id) {
    const { data, error } = await admin
      .from("product_compliance")
      .update(row)
      .eq("id", body.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, product: data });
  }
  const { data, error } = await admin.from("product_compliance").insert(row).select("*").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, product: data });
}
