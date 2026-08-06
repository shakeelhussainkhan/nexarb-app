import { NextResponse } from "next/server";

const EVENTS_URL = "http://137.184.184.27:3004/events";

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(EVENTS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`Events server returned ${res.status}`);
    const data: unknown = await res.json();
    const events = Array.isArray(data) ? data.slice(0, 20) : [];
    return NextResponse.json(events);
  } catch {
    return NextResponse.json([]);
  }
}
