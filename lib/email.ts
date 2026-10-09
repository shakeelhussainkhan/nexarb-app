import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Sends the NexArb welcome email. Called server-side only (from the verified
// Clerk webhook) - there is intentionally no public HTTP route for this.
export async function sendWelcomeEmail(name: string, email: string): Promise<void> {
  const firstName = name?.split(" ")[0] || "there";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to NexArb</title>
</head>
<body style="margin:0;padding:0;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 2px 24px rgba(13,27,42,0.07);">
    <!-- Header -->
    <div style="background:#0D1B2A;padding:40px;text-align:center;">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="30" fill="#B8922A"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
        <text x="32" y="40" text-anchor="middle" fill="#0D1B2A" font-size="24" font-weight="700" font-family="Georgia,serif">N</text>
      </svg>
      <h1 style="color:#fff;margin:16px 0 4px;font-size:24px;font-weight:600;font-family:Georgia,serif;">NexArb</h1>
      <p style="color:#B8922A;margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Arbitrage Intelligence</p>
    </div>
    <!-- Body -->
    <div style="padding:40px;">
      <h2 style="color:#0D1B2A;font-size:20px;margin:0 0 8px;">Welcome, ${firstName}!</h2>
      <p style="color:#6B7280;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Your 14-day free trial has started. Your arbitrage engine is warmed up and ready to find deals across Amazon, Walmart, and Alibaba.
      </p>
      <div style="background:#F7F8FA;border-radius:12px;padding:20px;margin:0 0 28px;">
        <p style="color:#0D1B2A;font-size:13px;font-weight:600;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">What happens next</p>
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">
          <span style="color:#B8922A;font-size:16px;margin-top:2px;">→</span>
          <p style="color:#374151;font-size:14px;margin:0;">ArbitrAI scans thousands of products daily across all channels</p>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">
          <span style="color:#B8922A;font-size:16px;margin-top:2px;">→</span>
          <p style="color:#374151;font-size:14px;margin:0;">Deals with verified margins land in your dashboard in real time</p>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#B8922A;font-size:16px;margin-top:2px;">→</span>
          <p style="color:#374151;font-size:14px;margin:0;">Buy or skip deals with one click — your pipeline, your rules</p>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:32px;">
        <a href="https://app.nexarb.io/dashboard" style="display:inline-block;background:linear-gradient(135deg,#B8922A,#D4A843);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;">
          View your deals →
        </a>
      </div>
      <p style="color:#9CA3AF;font-size:13px;text-align:center;margin:0;">
        Need help? Reply to this email anytime.
      </p>
    </div>
    <!-- Footer -->
    <div style="border-top:1px solid #F3F4F6;padding:20px 40px;text-align:center;">
      <p style="color:#D1D5DB;font-size:12px;margin:0;">© 2026 NexArb · <a href="https://nexarb.io" style="color:#D1D5DB;">nexarb.io</a></p>
    </div>
  </div>
</body>
</html>`;

  await resend.emails.send({
    from: "NexArb <hello@nexarb.io>",
    to: email,
    subject: "Welcome to NexArb — your arbitrage engine is ready",
    html,
  });
}
