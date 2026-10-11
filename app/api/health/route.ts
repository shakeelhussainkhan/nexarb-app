import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { checkWalmartHealth, walmartConfigFromEnv } from "@/lib/walmart/client";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";

// GET /api/health — first-party engine health.
// Reports the live connectivity of the two official APIs NexArb runs on.
// No relay involved; the dashboard badge reads this.
export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const spCfg = spApiConfigFromEnv(process.env);
  const spApiConfigured = spCfg !== null;

  let walmart: { connected: boolean; reason: string };
  try {
    const w = await checkWalmartHealth(walmartConfigFromEnv(process.env));
    walmart = { connected: w.connected, reason: w.connected ? "ok" : (w.reason ?? "not connected") };
  } catch (e) {
    walmart = {
      connected: false,
      reason: e instanceof Error ? e.message : "check failed",
    };
  }

  const online = spApiConfigured || walmart.connected;
  return NextResponse.json(
    {
      status: online ? "online" : "offline",
      engine: "nexarb-first-party",
      spApi: { configured: spApiConfigured },
      walmart,
      checkedAt: new Date().toISOString(),
    },
    { status: online ? 200 : 503 }
  );
}
