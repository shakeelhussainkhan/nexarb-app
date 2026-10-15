import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { syncFinances } from "@/lib/spapi/finances";

// POST /api/finances/sync
//
// Money module ingestion (PR-A): pulls Amazon Orders v0 + Finances v0
// for a bounded window and upserts sales_events (qty, unit price, fees
// per order+ASIN) and payouts (financial event groups / disbursements).
// Mapping rules live in lib/spapi/financesCore.ts; transport + writes
// in lib/spapi/finances.ts.
//
// Body (all optional): { days } (default 30, clamped 1–90) or explicit
// { from, to } ISO bounds; { maxPages } page guard per SP-API resource.
//
// Auth: Clerk session OR personal API key (X-NexArb-Key) — cron calls
// this with the key, like the other bounded passes.
//
// ROLE HONESTY: Orders/Finances access depends on the roles granted
// when the app was authorized in Seller Central. If SP-API denies a
// call, the sync writes NOTHING and returns success:false with the
// upstream error verbatim in errors[] — an empty-but-"successful" sync
// would silently hide a missing role behind an empty P&L.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 503 });
    }

    const cfg = spApiConfigFromEnv(process.env);
    if (!cfg) {
      return NextResponse.json({
        success: false,
        ordersSeen: 0,
        salesUpserted: 0,
        payoutsUpserted: 0,
        windowFrom: null,
        windowTo: null,
        errors: [
          "SP-API is not configured for this deployment (AMAZON_SPAPI_REFRESH_TOKEN / AMAZON_SPAPI_CLIENT_ID / AMAZON_SPAPI_CLIENT_SECRET / AMAZON_SELLER_ID missing) — nothing was synced.",
        ],
        warnings: [],
      });
    }

    let body: { days?: unknown; from?: unknown; to?: unknown; maxPages?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // Empty body is fine — defaults apply.
    }
    const result = await syncFinances(cfg, {
      days: typeof body.days === "number" && Number.isFinite(body.days) ? body.days : undefined,
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      maxPages: typeof body.maxPages === "number" && Number.isFinite(body.maxPages) ? body.maxPages : undefined,
    });

    return NextResponse.json({
      success: result.ok,
      ordersSeen: result.ordersSeen,
      salesUpserted: result.salesUpserted,
      payoutsUpserted: result.payoutsUpserted,
      windowFrom: result.windowFrom,
      windowTo: result.windowTo,
      errors: result.errors,
      warnings: result.warnings,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Finances sync failed." },
      { status: 500 }
    );
  }
}
