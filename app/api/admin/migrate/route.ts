import { NextRequest, NextResponse } from "next/server";

// Uses Supabase Management API to run raw SQL
// Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.RELAY_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
  }

  const MIGRATIONS = [
    `ALTER TABLE nexarb_settings ADD COLUMN IF NOT EXISTS telegram_connected BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE nexarb_settings ADD COLUMN IF NOT EXISTS telegram_connected_at TIMESTAMPTZ`,
    `ALTER TABLE nexarb_settings ADD COLUMN IF NOT EXISTS amz_marketplace TEXT`,
    `CREATE TABLE IF NOT EXISTS nexarb_affiliates (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      promotion_method TEXT,
      status TEXT DEFAULT 'pending',
      referral_code TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  const results: { sql: string; ok: boolean; error?: string }[] = [];

  // Extract project ref from URL (e.g. https://vpskkwuvqcdprmkgvuxc.supabase.co)
  const ref = supabaseUrl.replace("https://", "").split(".")[0];

  for (const sql of MIGRATIONS) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sql }),
      });

      const data = await res.json().catch(() => ({}));
      const trimmed = sql.trim().split("\n")[0].slice(0, 80);

      if (res.ok) {
        results.push({ sql: trimmed, ok: true });
      } else {
        results.push({ sql: trimmed, ok: false, error: data.error ?? data.message ?? "Failed" });
      }
    } catch (err) {
      const trimmed = sql.trim().split("\n")[0].slice(0, 80);
      results.push({ sql: trimmed, ok: false, error: err instanceof Error ? err.message : "Error" });
    }
  }

  return NextResponse.json({ results });
}
