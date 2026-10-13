import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// POST /api/compliance/profile — save the importer profile (legal IOR
// name, customs broker, bond) into nexarb_settings. Session only: this
// is the importer's own legal identity data.

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  let body: {
    iorLegalName?: string;
    brokerName?: string;
    bondProvider?: string;
    bondAmount?: number;
    trailingDutiesTaxesFees?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from("nexarb_settings")
    .upsert(
      {
        user_id: userId,
        ior_legal_name: body.iorLegalName ?? null,
        customs_broker_name: body.brokerName ?? null,
        customs_bond_provider: body.bondProvider ?? null,
        customs_bond_amount: body.bondAmount ?? null,
        trailing_duties_taxes_fees: body.trailingDutiesTaxesFees ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
