import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

function encrypt(text: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(key.padEnd(32, "0").slice(0, 32)),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { step, data } = await req.json();

  let payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };

  if (step === 1) {
    if (data.amz_seller_id) payload.amz_seller_id = data.amz_seller_id;
    if (data.amz_mws_token) payload.amz_mws_token = encrypt(data.amz_mws_token);
    // amz_marketplace: stored when migration runs, skipped otherwise
  } else if (step === 2) {
    if (data.walmart_client_id) payload.walmart_client_id = data.walmart_client_id;
    if (data.walmart_secret) payload.walmart_secret = encrypt(data.walmart_secret);
  } else if (step === 3) {
    if (data.min_profit !== undefined) payload.min_profit = data.min_profit;
    if (data.min_roi !== undefined) payload.min_roi = data.min_roi;
    if (data.max_bsr !== undefined) payload.max_bsr = data.max_bsr;
  }

  const { error } = await getSupabaseAdmin()
    .from("nexarb_settings")
    .upsert(payload, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
