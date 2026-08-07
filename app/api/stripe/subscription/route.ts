import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ subscription: null });
    }

    const { data } = await getSupabaseAdmin()
      .from("nexarb_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .single();

    return NextResponse.json({ subscription: data ?? null });
  } catch {
    return NextResponse.json({ subscription: null });
  }
}
