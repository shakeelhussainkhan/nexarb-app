import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const RELAY_URL = "http://137.184.184.27:3001";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const res = await fetch(`${RELAY_URL}/trigger-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, message: "Scan triggered", ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trigger failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
