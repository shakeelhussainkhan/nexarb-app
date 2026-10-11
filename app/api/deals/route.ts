import { NextResponse } from "next/server";
import { evaluateDeal, type DealVerdict } from "@/lib/engine/verdict";

const BACKEND_URL = "http://137.184.184.27:3001";

export interface Deal {
  id: number;
  asin: string;
  title: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  margin: number;
  bsr: number;
  channel: string;
  confidence: string;
  verifiedPrice: boolean;
  category: string;
  timestamp: string;
}

export interface EnrichedDeal extends Deal {
  engine: DealVerdict;
}

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(`${BACKEND_URL}/deals`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data: Deal[] = await res.json();
    const enriched: EnrichedDeal[] = data.map((d) => ({
      ...d,
      engine: evaluateDeal({
        buyPrice: d.buyPrice,
        sellPrice: d.sellPrice,
        bsr: d.bsr,
        category: d.category,
      }),
    }));
    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
