import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runDealCheck, persistDealCheck } from "@/lib/engine/dealcheck";

// POST /api/deals/check
// Full deal trace WITHOUT creating anything: given a candidate deal
// (asin + buyPrice from a retailer), the server fetches the LIVE Amazon sell
// price (SP-API Product Pricing), re-checks LIVE eligibility, runs the engine
// verdict, and evaluates the purchase guardrails. The trace is persisted to
// deal_checks so the dashboard can display it.
//
// Body: { asin, buyPrice, qty?, category? }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  const asin = String(body.asin ?? "").trim().toUpperCase();
  const buyPrice = Number(body.buyPrice);
  const qty = body.qty === undefined ? 10 : Number(body.qty);
  const category =
    body.category === undefined || body.category === null
      ? undefined
      : String(body.category);

  const problems: string[] = [];
  if (!/^[A-Z0-9]{10}$/.test(asin)) problems.push("Valid 10-character asin required.");
  if (!(buyPrice > 0) || !Number.isFinite(buyPrice))
    problems.push("buyPrice must be a positive number (observed retailer price).");
  if (!(qty > 0) || !Number.isFinite(qty)) problems.push("qty must be a positive number.");
  if (problems.length > 0) {
    return NextResponse.json({ error: "Invalid input", reasons: problems }, { status: 400 });
  }

  try {
    const trace = await runDealCheck(asin, buyPrice, qty, category);
    await persistDealCheck(trace, userId);
    return NextResponse.json({
      ...trace,
      nextStep:
        trace.guards.wouldCreateIntent && trace.verdict.state === "BUY"
          ? "Verdict is BUY and guards pass. Create the purchase intent with POST /api/purchases { asin, qty, unitPrice: buyPrice, sellPrice } — it will sit in PENDING_APPROVAL for your approval."
          : "No intent would be created. See guards.reasons and verdict.reasons above.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not tally committed spend",
        reasons: [e instanceof Error ? e.message : "unknown error"],
      },
      { status: 503 }
    );
  }
}
