import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { alibabaConfigFromEnv } from "@/lib/alibaba/core";
import { readAlibabaTokens } from "@/lib/alibaba/client";
import { getSupabaseAdmin } from "@/lib/supabase";

// GET /api/alibaba/status — is the server configured, and is this user's
// Alibaba buyer account connected? Session or API key.
export async function GET(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configured = alibabaConfigFromEnv(process.env) !== null;
  if (!configured || !supabaseIsConfigured(process.env)) {
    return NextResponse.json({ success: true, configured, connected: false, account: null, expiresAt: null });
  }

  try {
    const tokens = await readAlibabaTokens(getSupabaseAdmin(), identity.userId);
    return NextResponse.json({
      success: true,
      configured,
      connected: tokens !== null,
      account: tokens?.account ?? null,
      expiresAt: tokens?.expiresAt ?? null,
    });
  } catch {
    return NextResponse.json({ success: true, configured, connected: false, account: null, expiresAt: null });
  }
}
