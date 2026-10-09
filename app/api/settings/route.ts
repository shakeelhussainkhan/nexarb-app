import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encryptSecret } from "@/lib/crypto";

// Only these columns may be written through the settings UI. Anything else
// in the request body is ignored (prevents mass-assignment of columns owned
// by other flows, e.g. telegram linkage or marketplace identifiers).
const ALLOWED_FIELDS = [
  "display_name",
  "amz_seller_id",
  "walmart_client_id",
  "email_alerts",
  "high_confidence_only",
  "min_profit",
  "min_roi",
  "max_bsr",
  "excluded_categories",
] as const;

// Secret fields are encrypted at rest (AES-256, lib/crypto). Encryption
// fails closed: if ENCRYPTION_KEY is not configured the save is rejected
// rather than storing plaintext.
const SECRET_FIELDS = ["amz_mws_token", "walmart_secret"] as const;

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ settings: null });

    const { data } = await getSupabaseAdmin()
      .from("nexarb_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    return NextResponse.json({ settings: data ?? null });
  } catch {
    return NextResponse.json({ settings: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();

    const payload: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    for (const field of ALLOWED_FIELDS) {
      if (field in body) payload[field] = body[field];
    }

    for (const field of SECRET_FIELDS) {
      const value = body[field];
      if (typeof value === "string" && value.length > 0) {
        try {
          payload[field] = encryptSecret(value);
        } catch {
          return NextResponse.json(
            { error: "Server encryption not configured" },
            { status: 500 }
          );
        }
      }
    }

    const { error } = await getSupabaseAdmin()
      .from("nexarb_settings")
      .upsert(payload, { onConflict: "user_id" });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
