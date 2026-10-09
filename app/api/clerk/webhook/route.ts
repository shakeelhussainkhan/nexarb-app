import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

interface ClerkUserCreatedEvent {
  type: string;
  data: {
    id: string;
    email_addresses: { email_address: string }[];
    first_name: string | null;
    last_name: string | null;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: ClerkUserCreatedEvent = await req.json();

    if (body.type !== "user.created") {
      return NextResponse.json({ ok: true });
    }

    const { id, email_addresses, first_name, last_name } = body.data;
    const email = email_addresses?.[0]?.email_address ?? "";

    // Save user to Supabase
    try {
      await getSupabaseAdmin()
        .from("nexarb_users")
        .upsert({
          clerk_user_id: id,
          email,
          first_name: first_name ?? null,
          last_name: last_name ?? null,
          plan: "trial",
        }, { onConflict: "clerk_user_id" });
    } catch { /* Supabase may not be configured */ }

    // Send welcome email
    if (email) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/email/welcome`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: [first_name, last_name].filter(Boolean).join(" ") || email,
            email,
          }),
        });
      } catch { /* Email is best-effort */ }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
