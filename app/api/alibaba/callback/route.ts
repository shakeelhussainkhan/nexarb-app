import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { alibabaConfigFromEnv, alibabaRedirectUri } from "@/lib/alibaba/core";
import { exchangeAlibabaCode, saveAlibabaTokens } from "@/lib/alibaba/client";
import { getSupabaseAdmin } from "@/lib/supabase";

// GET /api/alibaba/callback — Alibaba redirects the founder's browser
// here with ?code=...&state=... after they authorize. The founder is
// signed into Clerk in the same browser, so the tokens are stored
// against their account. Every outcome lands back on /dashboard/alibaba
// with a status flag — this route never renders its own error page.

function backToDashboard(req: NextRequest, flag: string, detail?: string): NextResponse {
  const url = new URL("/dashboard/alibaba", req.url);
  url.searchParams.set("alibaba", flag);
  // Surface the provider's own error text (sanitized, truncated) so a
  // failed exchange is diagnosable from the dashboard instead of a
  // generic flag. Never includes secrets — Alibaba error payloads carry
  // error codes/descriptions only.
  if (detail) {
    url.searchParams.set("detail", detail.replace(/[\r\n]+/g, " ").slice(0, 200));
  }
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

  const exchanged = await exchangeAlibabaCode(cfg, code, alibabaRedirectUri(process.env));
  if (!exchanged.ok || !exchanged.tokens) {
    return backToDashboard(req, "exchange-failed", exchanged.error);
  }

  const saved = await saveAlibabaTokens(getSupabaseAdmin(), userId, exchanged.tokens);
  if (!saved.ok) return backToDashboard(req, "save-failed");

  return backToDashboard(req, "connected");
}
