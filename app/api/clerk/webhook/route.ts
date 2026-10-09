import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/lib/email";

// Clerk webhooks are signed by Svix. Verify svix-id / svix-timestamp /
// svix-signature against CLERK_WEBHOOK_SECRET before trusting the body.
// Throws when the secret is not configured (caller fails closed with 500).
function verifySvixSignature(req: NextRequest, payload: string): boolean {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("CLERK_WEBHOOK_SECRET is not configured");
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const timestamp = parseInt(svixTimestamp, 10);
  if (Number.isNaN(timestamp)) return false;
  // Reject signatures more than 5 minutes old (replay protection).
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", key)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  return svixSignature.split(" ").some((part: string) => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const signatureBuf = Buffer.from(signature);
    return (
      signatureBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(signatureBuf, expectedBuf)
    );
  });
}

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
  const payload = await req.text();

  let verified: boolean;
  try {
    verified = verifySvixSignature(req, payload);
  } catch {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: ClerkUserCreatedEvent;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

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

  // Send welcome email in-process (no unauthenticated HTTP self-call)
  if (email) {
    try {
      const name = [first_name, last_name].filter(Boolean).join(" ") || email;
      await sendWelcomeEmail(name, email);
    } catch (err) {
      console.error("Welcome email failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
