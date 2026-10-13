import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { screenProduct, complianceChecklist } from "@/lib/compliance/core";

// POST /api/compliance/screen — screen a product title + supplier against
// the prohibited-goods terms and brand watchlist, detect its regulatory
// category, and return the document/filing checklist that category
// triggers. Pure computation; persists nothing. Session or API key.

export async function POST(req: NextRequest) {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
  let body: { title?: string; supplierName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ success: false, error: "title is required." }, { status: 400 });
  }
  const screening = screenProduct({ title, supplierName: body.supplierName ?? null });
  return NextResponse.json({
    success: true,
    screening,
    checklist: complianceChecklist(screening.category),
  });
}
