import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = "http://137.184.184.27:3001";

interface ActionBody {
  asin: string;
  action: "buy" | "skip";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: ActionBody = await req.json();
    if (!body.asin || !body.action) {
      return NextResponse.json({ error: "asin and action required" }, { status: 400 });
    }
    const res = await fetch(`${BACKEND_URL}/deals/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to connect to ArbitrAI server" }, { status: 502 });
  }
}
