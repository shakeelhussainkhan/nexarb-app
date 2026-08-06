import { NextResponse } from "next/server";

const BACKEND_URL = "http://137.184.184.27:3001";

export interface DealsStats {
  totalToday: number;
  pendingCount: number;
  avgMargin: number;
  estTotalProfit: number;
  channelBreakdown: {
    amazon: number;
    walmart: number;
    alibaba: number;
  };
}

const FALLBACK: DealsStats = {
  totalToday: 0,
  pendingCount: 0,
  avgMargin: 0,
  estTotalProfit: 0,
  channelBreakdown: { amazon: 0, walmart: 0, alibaba: 0 },
};

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(`${BACKEND_URL}/deals/stats`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data: DealsStats = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(FALLBACK, { status: 200 });
  }
}
