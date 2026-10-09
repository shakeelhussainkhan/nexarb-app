import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const TELEGRAM_BOT_TOKEN = "7975263804:AAEhpsgYeAxVnzaTowVFmRZp502GKhhRKL4";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  // Send test message
  const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "✅ NexArb connected! You'll receive deal alerts here.",
      parse_mode: "HTML",
    }),
  });

  const tgData = await tgRes.json();

  if (!tgData.ok) {
    return NextResponse.json(
      { error: tgData.description ?? "Telegram delivery failed — check your Chat ID" },
      { status: 400 }
    );
  }

  // Save to Supabase — only use columns that exist in the original schema
  const { error } = await getSupabaseAdmin()
    .from("nexarb_settings")
    .upsert(
      {
        user_id: userId,
        telegram_chat_id: String(chatId),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Telegram connected!" });
}
