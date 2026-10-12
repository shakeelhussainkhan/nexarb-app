import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { runWatchlistScan } from "@/lib/engine/scan";
import { sendBuyAlert } from "@/lib/telegram/alerts";

// POST /api/scan/trigger
// First-party scan: runs every active watchlist item through the full
// deal-check pipeline (live sell price + live eligibility + engine verdict +
// guard dry-run) and persists each trace to deal_checks. The dashboard reads
// deal_checks, so results appear immediately — no dead relay involved.
// Auth: Clerk session OR personal API key (X-NexArb-Key) — the verification
// cron calls this server-side with a key, no browser session involved.
export async function POST(req: Request): Promise<NextResponse> {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = identity.userId;

  let scan;
  try {
    scan = await runWatchlistScan({ userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ success: false, error: message }, { status: 503 });
  }

  if (scan.checked === 0) {
    return NextResponse.json({
      success: true,
      message: "Watchlist is empty — add ASINs to scan.",
      checked: 0,
      buys: 0,
      results: [],
    });
  }

  // Telegram BUY alerts — notifications only, nothing purchases.
  let alertsSent = 0;
  const errors: string[] = [];
  for (const trace of scan.buyTraces) {
    const res = await sendBuyAlert(trace);
    if (res.ok) {
      alertsSent++;
    } else {
      errors.push(`alert failed for ${trace.asin}: ${res.error ?? "unknown error"}`);
    }
  }

  return NextResponse.json({
    success: true,
    message: `Scan complete: ${scan.checked} checked, ${scan.buys} BUY.`,
    checked: scan.checked,
    buys: scan.buys,
    alertsSent,
    priceDropAlertsSent: scan.priceDropAlertsSent,
    errors: [...errors, ...scan.priceDropErrors],
    results: scan.results,
  });
}
