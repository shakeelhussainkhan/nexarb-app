import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encryptSecret } from "@/lib/crypto";

// Encryption fails closed: when ENCRYPTION_KEY is missing/malformed,
// encryptSecret throws and the save is rejected (500) instead of storing
// marketplace secrets as plaintext.

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { step, data } = await req.json();

  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    if (step === 1) {
      if (data.amz_seller_id) payload.amz_seller_id = data.amz_seller_id;
      if (data.amz_mws_token) payload.amz_mws_token = encryptSecret(data.amz_mws_token);
      // amz_marketplace: stored when migration runs, skipped otherwise
    } else if (step === 2) {
      if (data.walmart_client_id) payload.walmart_client_id = data.walmart_client_id;
      if (data.walmart_secret) payload.walmart_secret = encryptSecret(data.walmart_secret);
    } else if (step === 3) {
      if (data.min_profit !== undefined) payload.min_profit = data.min_profit;
      if (data.min_roi !== undefined) payload.min_roi = data.min_roi;
      if (data.max_bsr !== undefined) payload.max_bsr = data.max_bsr;
    }
  } catch {
    return NextResponse.json(
      { error: "Server encryption not configured" },
      { status: 500 }
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("nexarb_settings")
    .upsert(payload, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
