import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ subscription: null });
    }

    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("nexarb_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (data) {
      return NextResponse.json({ subscription: data });
    }

    // Founder bootstrap (2026-10-10): the subscriptions table can be empty
    // (e.g. webhook never created a row), in which case the UI falls back to
    // "free". Provision an unlimited, non-expiring agency subscription for any
    // authenticated user with no row.
    // TODO: replace with 14-day trial provisioning before onboarding paying
    // customers — this must not grant agency to the public.
    let email = "";
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      email = user.emailAddresses[0]?.emailAddress ?? "";
    } catch {
      // email stays empty; row is still provisioned
    }

    const { data: created, error } = await admin
      .from("nexarb_subscriptions")
      .upsert(
        {
          user_id: userId,
          email,
          plan: "agency",
          status: "active",
          trial_ends_at: null,
          current_period_end: null,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error || !created) {
      return NextResponse.json({ subscription: null });
    }
    return NextResponse.json({ subscription: created });
  } catch {
    return NextResponse.json({ subscription: null });
  }
}
