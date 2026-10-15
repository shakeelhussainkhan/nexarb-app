// Watchlist promotion for evaluated supplier offers (NexArb Phase 1.5).
//
// A "candidate" verdict (lib/suppliers/evaluateCore.ts) is an opinion, not
// an action. Promotion is the deliberate human step that turns a candidate
// into a watchlist row, after which the EXISTING machinery takes over
// unchanged: the verification scan re-checks live price + eligibility and
// produces BUY/SKIP verdicts, gated-but-profitable items flow into the
// approval queue, and any purchase still starts as a PENDING_APPROVAL
// intent the founder approves per order. Promotion itself buys nothing,
// creates no intents, and is session-only at the route layer.
//
// Watchlist marker: buy_source = "supplier-<supplier>" (e.g.
// "supplier-petra") — the least invasive marker the scan/deals UI already
// tolerates (buy_source is a free-text provenance label everywhere it is
// read; the founder can see at a glance which rows came from a distributor
// shortlist vs the Walmart discovery sweeps). The offer row records the
// linkage in promoted_watchlist_asin (the watchlist's primary key IS the
// ASIN — see migration 019).

import { getSupabaseAdmin } from "@/lib/supabase";

interface PromotableOfferRow {
  id: string;
  supplier: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  product_class: string | null;
  subcategory: string | null;
  cost_price: number | string;
  matched_asin: string | null;
  eval_verdict: string | null;
  promoted_watchlist_asin: string | null;
}

export interface PromoteResult {
  promoted: Array<{ offerId: string; asin: string }>;
  skipped: Array<{ offerId: string; reason: string }>;
  errors: string[];
}

export const PROMOTE_MAX_PER_CALL = 100;
export const supplierBuySource = (supplier: string) => `supplier-${supplier}`;

export async function promoteOffersToWatchlist(offerIds: string[]): Promise<PromoteResult> {
  const result: PromoteResult = { promoted: [], skipped: [], errors: [] };
  const ids = [...new Set(offerIds.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean))];
  if (ids.length === 0) return result;
  if (ids.length > PROMOTE_MAX_PER_CALL) {
    result.errors.push(`Too many offers (max ${PROMOTE_MAX_PER_CALL} per call).`);
    return result;
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("supplier_offers")
    .select(
      "id, supplier, title, brand, image_url, product_class, subcategory, cost_price, matched_asin, eval_verdict, promoted_watchlist_asin"
    )
    .in("id", ids);
  if (error) {
    result.errors.push(`Could not read offers: ${error.message}`);
    return result;
  }
  const byId = new Map(
    ((data ?? []) as PromotableOfferRow[]).map((r) => [r.id, r] as const)
  );

  // One watchlist read for every ASIN in play (same dedupe discipline as
  // discovery ingest): an ASIN already watched is never duplicated.
  const asins = [...byId.values()].map((r) => r.matched_asin).filter((a): a is string => !!a);
  const existing = new Set<string>();
  if (asins.length > 0) {
    const { data: wData, error: wErr } = await admin.from("watchlist").select("asin").in("asin", asins);
    if (wErr) {
      result.errors.push(`Could not read watchlist: ${wErr.message}`);
      return result;
    }
    for (const r of (wData ?? []) as Array<{ asin: string }>) existing.add(r.asin);
  }

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      result.skipped.push({ offerId: id, reason: "offer not found" });
      continue;
    }
    const asin = row.matched_asin;
    if (!asin) {
      result.skipped.push({ offerId: id, reason: "offer is not matched to an ASIN" });
      continue;
    }
    if (row.promoted_watchlist_asin) {
      result.skipped.push({ offerId: id, reason: `already promoted (ASIN ${row.promoted_watchlist_asin})` });
      continue;
    }
    if (row.eval_verdict !== "candidate") {
      result.skipped.push({
        offerId: id,
        reason: `verdict is ${row.eval_verdict ?? "unevaluated"} — only candidates can be promoted`,
      });
      continue;
    }
    if (existing.has(asin)) {
      // Already watched (e.g. via discovery): record the linkage so the
      // offer shows its promoted state, but never duplicate the row.
      const { error: linkErr } = await admin
        .from("supplier_offers")
        .update({ promoted_watchlist_asin: asin })
        .eq("id", id);
      if (linkErr) result.errors.push(`${asin}: could not record promotion link: ${linkErr.message}`);
      result.skipped.push({ offerId: id, reason: `ASIN ${asin} is already on the watchlist` });
      continue;
    }

    const { error: insErr } = await admin.from("watchlist").insert({
      asin,
      title: row.title,
      buy_price: Number(row.cost_price),
      buy_source: supplierBuySource(row.supplier),
      category: row.product_class ?? row.subcategory ?? null,
      active: true,
      source_url: null,
      product_title: row.title,
      product_brand: row.brand,
      product_image_url: row.image_url,
    });
    if (insErr) {
      result.errors.push(`${asin}: watchlist insert failed: ${insErr.message}`);
      continue;
    }
    existing.add(asin);
    const { error: linkErr } = await admin
      .from("supplier_offers")
      .update({ promoted_watchlist_asin: asin })
      .eq("id", id);
    if (linkErr) {
      result.errors.push(`${asin}: promoted, but recording the link failed: ${linkErr.message}`);
    }
    result.promoted.push({ offerId: id, asin });
  }
  return result;
}
