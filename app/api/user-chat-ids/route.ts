import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") ||
    req.headers.get("x-relay-secret");

  if (!process.env.RELAY_API_SECRET || secret !== process.env.RELAY_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("nexarb_settings")
      .select("telegram_chat_id")
      .not("telegram_chat_id", "is", null);

    if (error) throw error;

    const chatIds = (data ?? [])
      .map((r) => r.telegram_chat_id)
      .filter(Boolean);

    return NextResponse.json({ chatIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
