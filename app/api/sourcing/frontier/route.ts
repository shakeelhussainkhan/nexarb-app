import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { supabaseIsConfigured } from "@/lib/engine/guards";
import { coerceSupplierOffer, type SupplierOffer } from "@/lib/suppliers/petraCore";
import { FRONTIER_SUPPLIER } from "@/lib/suppliers/frontierCore";
import { ingestSupplierOffers } from "@/lib/suppliers/offers";

// POST /api/sourcing/frontier
//
// Ingests normalized Frontier Co-op supplier offers (parsed from the
// published monthly XLSX catalog files by scripts/frontier-ingest.mjs via
// lib/suppliers/frontierCore.ts) into `supplier_offers`, upserting by
// (supplier, supplier_sku). A refresh updates cost/last_seen only —
// resolved ASINs and stored price estimates survive re-ingest. Follow
// with POST /api/sourcing/frontier/match and /api/sourcing/frontier/scan
// to resolve ASINs and price them.
//
// Body: { offers: [SupplierOffer...], sourceFileDate?: "YYYY-MM-DD" }
// Auth: Clerk session OR personal API key (X-NexArb-Key) — the ingest
// helper runs server-side with a key, exactly like discovery ingest.
//
// INGEST ONLY — nothing here purchases, creates intents, or spends money.
// The handler never throws: every failure path returns JSON.

const MAX_OFFERS_PER_INGEST = 5000;

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const identity = await resolveUser(req);
    if (identity.kind !== "identity") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!supabaseIsConfigured(process.env)) {
      return NextResponse.json(
        { success: false, error: "Supabase is not configured — nowhere to store supplier offers." },
        { status: 503 }
      );
    }

    let body: { offers?: unknown; sourceFileDate?: unknown };
    try {
      body = (await req.json()) as { offers?: unknown; sourceFileDate?: unknown };
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const rawOffers = Array.isArray(body.offers) ? body.offers : [];
    if (rawOffers.length === 0) {
      return NextResponse.json({ success: true, received: 0, inserted: 0, updated: 0, matched: 0, errors: [] });
    }
    if (rawOffers.length > MAX_OFFERS_PER_INGEST) {
      return NextResponse.json(
        { success: false, error: `Too many offers (max ${MAX_OFFERS_PER_INGEST} per call) — post in batches.` },
        { status: 400 }
      );
    }

    const offers: SupplierOffer[] = [];
    let invalid = 0;
    for (const raw of rawOffers) {
      const offer = coerceSupplierOffer(raw, FRONTIER_SUPPLIER);
      if (offer) offers.push(offer);
      else invalid++;
    }

    const sourceFileDate =
      typeof body.sourceFileDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.sourceFileDate)
        ? body.sourceFileDate
        : null;

    const result = await ingestSupplierOffers(FRONTIER_SUPPLIER, offers, sourceFileDate);
    return NextResponse.json({
      success: true,
      ...result,
      errors: [
        ...(invalid > 0 ? [`${invalid} offer(s) skipped: missing SKU or a positive cost price.`] : []),
        ...result.errors,
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Supplier ingest failed." },
      { status: 500 }
    );
  }
}
