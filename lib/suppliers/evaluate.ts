// Server wiring for supplier-offer evaluation: for matched + priced
// offers, fetch the two signals the ingest pipeline does not store —
// current sales rank (SP-API Catalog Items, the same call the deal check
// uses, in lib/engine/velocity.ts) and sell eligibility (SP-API Listings
// Restrictions via lib/engine/eligibility.ts) — paced through the shared
// SP-API throttle, then run the pure core (lib/suppliers/evaluateCore.ts)
// and persist verdict / score / reasons / evaluated_at on the offer row.
//
// Bounded and idempotent like the match/pricing passes: fresh evaluations
// are skipped; stale ones (>24h) refresh only when the caller passes
// refresh=true. Nothing here orders, promotes, or spends money — promotion
// to the watchlist is a separate, session-only, human action
// (POST /api/suppliers/promote).

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  spApiConfigFromEnv,
  checkEligibility,
  EligibilityCache,
  type EligibilityState,
} from "@/lib/engine/eligibility";
import { fetchSalesRankSnapshot, recordVelocitySnapshot } from "@/lib/engine/velocity";
import { SpApiThrottle } from "@/lib/sourcing/throttle";
import { FRONTIER_SUPPLIER } from "./frontierCore";
import {
  evaluateOffer,
  type EvalEligibility,
  type EvalVerdict,
} from "./evaluateCore";

// Restricted results re-check sooner inside the cache itself (3h TTL), so
// sharing one cache across evaluations within a warm instance is safe and
// saves Listings Restrictions calls for ASINs evaluated minutes apart.
const eligibilityCache = new EligibilityCache();

const STALE_AFTER_MS = 24 * 3600 * 1000;

interface EvalOfferRow {
  id: string;
  supplier: string;
  supplier_sku: string;
  title: string;
  brand: string | null;
  product_class: string | null;
  subcategory: string | null;
  cost_price: number | string;
  qty_available: number;
  matched_asin: string | null;
  amazon_price: number | string | null;
}

function mapEligibility(state: EligibilityState): EvalEligibility {
  switch (state) {
    case "SELLABLE":
      return "ELIGIBLE";
    case "APPROVAL_REQUIRED":
      return "APPROVAL_REQUIRED";
    case "BLOCKED":
      return "BLOCKED";
    default:
      return "UNKNOWN";
  }
}

export interface EvaluateOffersResult {
  processed: number;
  candidates: number;
  watch: number;
  pass: number;
  errors: string[];
}

export async function evaluateSupplierOffers(opts: {
  supplier?: string | null;
  limit?: number;
  refresh?: boolean;
} = {}): Promise<EvaluateOffersResult> {
  const result: EvaluateOffersResult = { processed: 0, candidates: 0, watch: 0, pass: 0, errors: [] };
  const cfg = spApiConfigFromEnv(process.env);
  if (!cfg) {
    result.errors.push("SP-API not configured — evaluation skipped.");
    return result;
  }
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 200));
  const admin = getSupabaseAdmin();

  let query = admin
    .from("supplier_offers")
    .select(
      "id, supplier, supplier_sku, title, brand, product_class, subcategory, cost_price, qty_available, matched_asin, amazon_price, evaluated_at"
    )
    .eq("match_status", "matched")
    .not("matched_asin", "is", null)
    .not("amazon_price", "is", null)
    .not("priced_at", "is", null);
  if (opts.supplier) query = query.eq("supplier", opts.supplier);
  if (opts.refresh) {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    query = query.or(`evaluated_at.is.null,evaluated_at.lt.${cutoff}`);
  } else {
    query = query.is("evaluated_at", null);
  }
  const { data, error } = await query
    .order("est_margin_pct", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    result.errors.push(`Could not read offers to evaluate: ${error.message}`);
    return result;
  }
  const rows = (data ?? []) as EvalOfferRow[];

  // One throttle per pass (same pacing discipline as match/pricing): both
  // signal calls route through it so Catalog + Restrictions traffic shares
  // one rate limiter and one 429 backoff.
  const throttle = new SpApiThrottle({ minIntervalMs: 1000 });
  const spFetch: typeof fetch = (input, init) => throttle.fetch(input, init, fetch);

  for (const row of rows) {
    result.processed++;
    const asin = row.matched_asin ?? "";
    try {
      const { rank, category } = await fetchSalesRankSnapshot(cfg, asin, spFetch);
      // First-party velocity data: record this rank exactly like the deal
      // check does, so evaluation also grows the snapshot series the
      // velocity model reads. Best-effort inside the helper.
      await recordVelocitySnapshot(admin, asin, rank, category);
      const eligibility = await checkEligibility(cfg, asin, eligibilityCache, spFetch);

      const evaluation = evaluateOffer(
        {
          supplier: row.supplier,
          title: row.title,
          brand: row.brand,
          productClass: row.product_class,
          subcategory: row.subcategory,
          costPrice: Number(row.cost_price),
        },
        {
          amazonPrice: Number(row.amazon_price),
          bsr: rank,
          category: category ?? row.product_class ?? row.subcategory,
          eligibility: mapEligibility(eligibility.state),
          // Frontier's files carry no stock counts — qty_available there is
          // a schema default (0), NOT a real zero. Unknown stays unknown.
          stockAtSupplier: row.supplier === FRONTIER_SUPPLIER ? null : row.qty_available,
        }
      );

      const { error: upErr } = await admin
        .from("supplier_offers")
        .update({
          eval_verdict: evaluation.verdict,
          eval_score: evaluation.score,
          eval_reasons: evaluation.reasons,
          evaluated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (upErr) {
        result.errors.push(`${row.supplier_sku}: ${upErr.message}`);
        continue;
      }
      const bucket: EvalVerdict = evaluation.verdict;
      if (bucket === "candidate") result.candidates++;
      else if (bucket === "watch") result.watch++;
      else result.pass++;
    } catch (e) {
      result.errors.push(
        `${row.supplier_sku}: evaluation failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return result;
}
