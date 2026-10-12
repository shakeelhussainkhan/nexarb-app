import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateApiKey } from "@/lib/extension/keys";

// GET /api/settings/api-keys — list the caller's keys (hashes never leave the DB).
// POST /api/settings/api-keys { action: "create", name? } — mint a key, return plaintext ONCE.
// POST /api/settings/api-keys { action: "revoke", id } — soft-revoke a key.
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await getSupabaseAdmin()
      .from("api_keys")
      .select("id, name, created_at, last_used_at, revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ keys: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not load API keys", reasons: [e instanceof Error ? e.message : "unknown"] },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const action = String(body.action ?? "");
    const admin = getSupabaseAdmin();

    if (action === "create") {
      const name = String(body.name ?? "extension").slice(0, 64) || "extension";
      const { plaintext, hash } = generateApiKey();
      const { data, error } = await admin
        .from("api_keys")
        .insert({ user_id: userId, key_hash: hash, name })
        .select("id, name, created_at")
        .single();
      if (error) throw new Error(error.message);
      // Plaintext is returned exactly once — it is never stored.
      return NextResponse.json({ key: data, plaintext });
    }

    if (action === "revoke") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ error: "Key id required." }, { status: 400 });
      const { error } = await admin
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ revoked: true });
    }

    return NextResponse.json({ error: 'Unknown action. Use "create" or "revoke".' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not manage API keys", reasons: [e instanceof Error ? e.message : "unknown"] },
      { status: 503 }
    );
  }
}
