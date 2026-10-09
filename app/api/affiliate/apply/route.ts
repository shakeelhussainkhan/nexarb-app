import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NEXARB-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function POST(req: NextRequest) {
  const { name, email, promotion_method } = await req.json();

  if (!name || !email) {
    return NextResponse.json({ error: "Name and email required" }, { status: 400 });
  }

  const referral_code = generateCode();

  const { error } = await getSupabaseAdmin()
    .from("nexarb_affiliates")
    .insert({
      name,
      email: email.toLowerCase().trim(),
      promotion_method: promotion_method ?? null,
      referral_code,
      status: "pending",
    });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This email is already registered as an affiliate." },
        { status: 409 }
      );
    }
    if (error.message?.includes("does not exist")) {
      return NextResponse.json(
        { error: "Affiliate program setup pending. Please try again in 24 hours." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Send confirmation email via Resend
  if (process.env.RESEND_API_KEY) {
    const emailHtml = `
      <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; color: #0D1B2A;">
        <div style="background: #0D1B2A; padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: #B8922A; font-size: 24px; margin: 0;">NexArb Affiliates</h1>
        </div>
        <div style="background: #F9FAFB; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #E5E7EB; border-top: none;">
          <h2 style="font-size: 20px; margin: 0 0 16px;">Welcome, ${name}!</h2>
          <p style="color: #6B7280; margin: 0 0 24px;">You've been accepted to the NexArb Affiliate Program. Start earning 30% recurring commissions today.</p>
          <div style="background: #fff; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #9CA3AF;">Your Referral Code</p>
            <p style="font-size: 28px; font-weight: 700; color: #B8922A; margin: 0; letter-spacing: 0.1em;">${referral_code}</p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #6B7280;">Share link: https://nexarb.io/?ref=${referral_code}</p>
          </div>
          <h3 style="font-size: 16px; margin: 0 0 12px;">Commission Rates</h3>
          <ul style="color: #374151; margin: 0 0 24px; padding-left: 20px; line-height: 1.8;">
            <li>Solo plan: $29.70/month per referral</li>
            <li>Professional: $59.70/month per referral</li>
            <li>Agency: $119.70/month per referral</li>
          </ul>
          <p style="font-size: 13px; color: #9CA3AF; margin: 0;">Questions? Reply to this email or contact us at hello@nexarb.io</p>
        </div>
      </div>
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "NexArb <hello@nexarb.io>",
        to: email,
        subject: "Welcome to NexArb Affiliates!",
        html: emailHtml,
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, referral_code });
}
