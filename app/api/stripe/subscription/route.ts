import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ subscription: null });
    }

    const admin = getSupabaseAdmin();

    // 1) Existing row wins.
    const { data: existing } = await admin
      .from("nexarb_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ subscription: existing });
    }

    // 2) Founder bootstrap (2026-10-10): the subscriptions table can be empty
    // (webhook never created a row), in which case the UI falls back to
    // "free". Provision an unlimited, non-expiring agency subscription.
    // TODO: replace with 14-day trial provisioning before onboarding paying
    // customers — this must not grant agency to the public.
    const { data: created, error } = await admin
      .from("nexarb_subscriptions")
      .upsert(
        {
          user_id: userId,
          email: "",
          plan: "agency",
          status: "active",
          trial_ends_at: null,
          current_period_end: null,
        },
        { onConflict: "user_id" }
      )
      .select()
      .maybeSingle();

    if (error) {
      console.error("[subscription] auto-provision failed:", error.message);
    }
    // provisionError is a diagnostic aid; the UI ignores it.
    return NextResponse.json({
      subscription: created ?? null,
      provisionError: error?.message ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[subscription] GET failed:", message);
    return NextResponse.json({ subscription: null, provisionError: message });
  }
}
