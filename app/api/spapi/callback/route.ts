// One-time founder setup: Amazon SP-API OAuth callback.
// Register https://app.nexarb.io/api/spapi/callback as the OAuth Redirect URI
// when creating the SP-API app in Seller Central, then authorize via:
//   https://sellercentral.amazon.com/apps/authorize/consent?application_id=<APP_ID>&state=nexarb-setup&redirect_uri=https://app.nexarb.io/api/spapi/callback&version=beta
// Amazon redirects here with ?spapi_oauth_code=... — GET renders a small form
// asking for the LWA Client ID + Secret, POST exchanges the code for a
// refresh token and displays it for copy/paste into Vercel env.
// TODO: delete this route after the founder completes SP-API setup.

import { NextResponse } from "next/server";

const REDIRECT_URI = "https://app.nexarb.io/api/spapi/callback";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#0D1B2A}code{background:#f1f5f9;padding:2px 6px;border-radius:6px}input{width:100%;padding:10px;margin:6px 0 12px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box}button{background:#0D1B2A;color:#fff;padding:12px 20px;border:0;border-radius:10px;font-size:15px;cursor:pointer}.token{background:#0f172a;color:#a7f3d0;padding:16px;border-radius:10px;word-break:break-all;font-family:monospace;font-size:13px}</style></head>` +
      `<body>${body}</body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("spapi_oauth_code") ?? "";
  const err = url.searchParams.get("spapi_oauth_error") ?? "";
  if (err) {
    return page(
      "SP-API setup — error",
      `<h1>Authorization failed</h1><p>Amazon returned: <code>${esc(err)}</code></p><p>Go back to Seller Central and run the consent step again.</p>`
    );
  }
  if (!code) {
    return page(
      "SP-API setup",
      `<h1>NexArb SP-API setup</h1><p>This page completes Amazon's OAuth consent flow. If you landed here directly (no code), start from the authorization URL in the setup guide.</p>`
    );
  }
  return page(
    "SP-API setup",
    `<h1>Almost done</h1><p>Amazon sent back an authorization code. Paste your app's <b>LWA Client ID</b> and <b>Client Secret</b> (Seller Central → Partner Network → Develop Apps → your app) to exchange it for a refresh token.</p>` +
      `<form method="POST"><input type="hidden" name="code" value="${esc(code)}">` +
      `<label>Client ID<br><input name="client_id" required autocomplete="off"></label>` +
      `<label>Client Secret<br><input name="client_secret" type="password" required autocomplete="off"></label>` +
      `<button type="submit">Get refresh token</button></form>`
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const clientSecret = String(form.get("client_secret") ?? "");
  if (!code || !clientId || !clientSecret) {
    return page(
      "SP-API setup — error",
      `<h1>Missing fields</h1><p>Client ID, Client Secret, and the authorization code are all required.</p>`
    );
  }
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { refresh_token?: string };
  if (!res.ok || !data.refresh_token) {
    return page(
      "SP-API setup — error",
      `<h1>Token exchange failed</h1><p>Amazon said: <code>${esc(JSON.stringify(data).slice(0, 500))}</code></p>` +
        `<p>Double-check the Client ID and Secret. Authorization codes expire within minutes — re-run the consent step for a fresh code if needed.</p>`
    );
  }
  return page(
    "SP-API setup — done",
    `<h1>Got it</h1><p>Copy this refresh token into Vercel → Environment Variables → <b>Production</b> as <code>AMAZON_SPAPI_REFRESH_TOKEN</code>:</p>` +
      `<div class="token">${esc(data.refresh_token)}</div>` +
      `<p style="margin-top:16px">Also add <code>AMAZON_SPAPI_CLIENT_ID</code>, <code>AMAZON_SPAPI_CLIENT_SECRET</code>, and <code>AMAZON_SELLER_ID</code> (Seller Central → Settings → Account Info → Merchant Token), then redeploy. Eligibility checks go live after that.</p>`
  );
}
