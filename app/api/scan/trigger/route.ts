import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runWatchlistScan } from "@/lib/engine/scan";

// POST /api/scan/trigger
// First-party scan: runs every active watchlist item through the full
// deal-check pipeline (live sell price + live eligibility + engine verdict +
// guard dry-run) and persists each trace to deal_checks. The dashboard reads
// deal_checks, so results appear immediately — no dead relay involved.
export async function POST(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  return NextResponse.json({
    success: true,
    message: `Scan complete: ${scan.checked} checked, ${scan.buys} BUY.`,
    checked: scan.checked,
    buys: scan.buys,
    results: scan.results,
  });
}
