import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { alibabaConfigFromEnv } from "@/lib/alibaba/core";
import { exchangeAlibabaCode, saveAlibabaTokens } from "@/lib/alibaba/client";
import { getSupabaseAdmin } from "@/lib/supabase";

// GET /api/alibaba/callback — Alibaba redirects the founder's browser
// here with ?code=...&state=... after they authorize. The founder is
// signed into Clerk in the same browser, so the tokens are stored
// against their account. Every outcome lands back on /dashboard/alibaba
// with a status flag — this route never renders its own error page.

function backToDashboard(req: NextRequest, flag: string): NextResponse {
  const url = new URL("/dashboard/alibaba", req.url);
  url.searchParams.set("alibaba", flag);
  const res = NextResponse.redirect(url);
  res.cookies.delete("alibaba_oauth_state");
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return backToDashboard(req, "session-missing");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("alibaba_oauth_state")?.value;
  if (!code) return backToDashboard(req, "no-code");
  if (!expectedState || state !== expectedState) return backToDashboard(req, "bad-state");

  const cfg = alibabaConfigFromEnv(process.env);
  if (!cfg) return backToDashboard(req, "not-configured");

  const exchanged = await exchangeAlibabaCode(cfg, code);
  if (!exchanged.ok || !exchanged.tokens) return backToDashboard(req, "exchange-failed");

  const saved = await saveAlibabaTokens(getSupabaseAdmin(), userId, exchanged.tokens);
  if (!saved.ok) return backToDashboard(req, "save-failed");

  return backToDashboard(req, "connected");
}
