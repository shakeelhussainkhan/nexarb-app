import { NextResponse } from "next/server";
import { checkWalmartHealth, walmartConfigFromEnv } from "@/lib/walmart/client";

// GET /api/walmart/health
// Live Walmart Marketplace API connectivity check: exchanges the seller's
// ClientId/ClientSecret for an access token and reads token detail.
// Returns { connected: true } on success; never a false positive.
export async function GET(): Promise<NextResponse> {
  const cfg = walmartConfigFromEnv(process.env);
  const result = await checkWalmartHealth(cfg);
  return NextResponse.json(result, {
    status: result.connected ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
