import { NextRequest, NextResponse } from "next/server";
import { runWatchlistScan } from "@/lib/engine/scan";
import { sendBuyAlert } from "@/lib/telegram/alerts";
import { cronAuthStatus } from "@/lib/cron/auth";

// Scheduled watchlist scan — hit by Vercel Cron 3x daily PT (see vercel.json).
// Auth: requires Authorization: Bearer <CRON_SECRET>. Vercel injects
// CRON_SECRET automatically for cron jobs. If CRON_SECRET is missing the
// endpoint refuses to run unauthenticated (503) — it never runs open.
// Alerts are notifications only: nothing here purchases or spends money.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const status = cronAuthStatus(req.headers.get("authorization"));
  if (status === 503) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }
  if (status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const errors: string[] = [];
  let checked = 0;
  let buys = 0;
  let alertsSent = 0;
  let priceDropAlertsSent = 0;

  try {
    const scan = await runWatchlistScan();
    checked = scan.checked;
    buys = scan.buys;
    priceDropAlertsSent = scan.priceDropAlertsSent;
    errors.push(...scan.priceDropErrors);
    for (const trace of scan.buyTraces) {
      const res = await sendBuyAlert(trace);
      if (res.ok) {
        alertsSent++;
      } else {
        errors.push(`alert failed for ${trace.asin}: ${res.error ?? "unknown error"}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Scan failed");
    return NextResponse.json(
      { success: false, checked, buys, alertsSent, priceDropAlertsSent, errors },
      { status: 503 }
    );
  }

  return NextResponse.json({ success: true, checked, buys, alertsSent, priceDropAlertsSent, errors });
}

// Vercel Cron Jobs invoke the path with GET, so the scheduled job lands here.
// POST keeps working for manual authenticated triggers.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
