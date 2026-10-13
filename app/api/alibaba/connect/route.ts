import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { alibabaConfigFromEnv } from "@/lib/alibaba/core";

// GET /api/alibaba/connect — starts the buyer OAuth flow. Session-only:
// the founder connects their own Alibaba buyer account. Sets a short-
// lived state cookie the callback verifies, then redirects to Alibaba.
export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = alibabaConfigFromEnv(process.env);
  if (!cfg) {
    return NextResponse.json(
      { error: "Alibaba is not configured on the server (ALIBABA_APP_KEY / ALIBABA_APP_SECRET missing)." },
      { status: 503 }
    );
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.nexarb.io").replace(/\/+$/, "");
  const redirectUri = `${appUrl}/api/alibaba/callback`;
  const state = randomBytes(16).toString("hex");
  const authorizeUrl =
    `${cfg.authBase}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(cfg.appKey)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("alibaba_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/alibaba",
    maxAge: 600,
  });
  return res;
}
