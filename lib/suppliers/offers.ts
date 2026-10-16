// Shared server wiring for supplier offers: ingest upsert, UPC→ASIN
// matching, and the Amazon pricing/margin pass — parameterized by
// supplier ("petra", "frontier", ...). The supplier-specific modules
// (petra.ts, the frontier routes) are thin adapters over this file; the
// pure parsing and fee math live in the *Core.ts modules.
//
// Scope: ingest + match + price ONLY. Nothing here orders, creates
// purchase intents, or spends money. Every function resolves a result
// object — failures are collected, never thrown at the caller.

import { getSupabaseAdmin } from "@/lib/supabase";
import { spApiConfigFromEnv } from "@/lib/engine/eligibility";
import { matchUpcToAsin, createTokenCache } from "@/lib/sourcing/match";
import { SpApiThrottle } from "@/lib/sourcing/throttle";
import { getLiveSellPrice } from "@/lib/spapi/pricing";
import {
  estimateSupplierNet,
  type SupplierOffer,
} from "./petraCore";
import {
  PRICE_ATTEMPT_MAX,
  PRICE_ATTEMPT_SPACING_MS,
  PRICE_SCAN_DEFAULT_CAP,
  PRICE_SCAN_MAX_CAP,
  PRICE_SCAN_OVERSAMPLE,
  pickPricingBatch,
} from "./pricingCore";

const UPSERT_CHUNK = 500;

interface OfferRow {
  id: string;
  supplier_sku: string;
  upc: string | null;
  matched_asin: string | null;
  cost_price: number | string;
  product_class: string | null;
  subcategory: string | null;
  // Pricing-attempt state (migration 024) — only the pricing pass
  // selects/stamps these; other passes leave them absent.
  price_attempts?: number | null;
  price_attempted_at?: string | null;
}

function offerToRow(supplier: string, o: SupplierOffer, nowIso: string) {
  return {
    supplier,
    supplier_sku: o.supplierSku,
    vendor_sku: o.vendorSku,
    title: o.title,
    brand: o.brand,
    upc: o.upc,
    cost_price: o.costPrice,
    map_price: o.mapPrice,
    msrp: o.msrp,
    qty_available: o.qtyAvailable,
    image_url: o.imageUrl,
    product_class: o.productClass,
    subcategory: o.subcategory,
    weight_lb: o.weightLb,
    origin_country: o.originCountry,
    last_seen_at: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Ingest: upsert normalized offers by (supplier, supplier_sku) and record
// the run. Re-ingesting a newer feed refreshes cost/qty/last_seen only —
// match and pricing columns are deliberately NOT in the upsert payload, so
// a refresh never wipes a resolved ASIN or a stored estimate.
// ---------------------------------------------------------------------------

export interface IngestOffersResult {
  received: number;
  inserted: number;
  updated: number;
  matched: number;
  errors: string[];
}

export async function ingestSupplierOffers(
  supplier: string,
  offers: SupplierOffer[],
  sourceFileDate: string | null
): Promise<IngestOffersResult> {
  const errors: string[] = [];
  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < offers.length; i += UPSERT_CHUNK) {
    const chunk = offers.slice(i, i + UPSERT_CHUNK);
    const skus = chunk.map((o) => o.supplierSku);
    const { data: existing, error: readErr } = await admin
      .from("supplier_offers")
      .select("supplier_sku")
      .eq("supplier", supplier)
      .in("supplier_sku", skus);
    if (readErr) {
      errors.push(`Could not read existing offers: ${readErr.message}`);
      continue;
    }
    const existingSet = new Set(
      ((existing ?? []) as Array<{ supplier_sku: string }>).map((r) => r.supplier_sku)
    );
    const { error: writeErr } = await admin
      .from("supplier_offers")
      .upsert(chunk.map((o) => offerToRow(supplier, o, nowIso)), {
        onConflict: "supplier,supplier_sku",
      });
    if (writeErr) {
      errors.push(`Could not upsert offers: ${writeErr.message}`);
      continue;
    }
    for (const o of chunk) {
      if (existingSet.has(o.supplierSku)) updated++;
      else inserted++;
    }
  }

  // How many of this batch's SKUs already carry a resolved ASIN.
  let matched = 0;
  if (offers.length > 0 && errors.length === 0) {
    const { count } = await admin
      .from("supplier_offers")
      .select("id", { count: "exact", head: true })
      .eq("supplier", supplier)
      .in("supplier_sku", offers.slice(0, UPSERT_CHUNK).map((o) => o.supplierSku))
      .not("matched_asin", "is", null);
    matched = count ?? 0;
  }

  const { error: runErr } = await admin.from("supplier_import_runs").insert({
    supplier,
    source_file_date: sourceFileDate,
    rows_received: offers.length,
    inserted,
    updated,
    matched,
  });
  if (runErr) errors.push(`Could not record import run: ${runErr.message}`);

  return { received: offers.length, inserted, updated, matched, errors };
}

// ---------------------------------------------------------------------------
// Matching: resolve pending offers' UPCs to Amazon ASINs with the exact
// matcher discovery ingest uses (SP-API Catalog Items), paced through the
// shared throttle with one cached LWA token per run. Idempotent: matched
// and no_match rows are never re-looked-up; 'error' rows (transient API
// failures) are retried on the next pass.
// ---------------------------------------------------------------------------

export interface MatchOffersResult {
  processed: number;
  matched: number;
  noMatch: number;
  errored: number;
  errors: string[];
}

function classifyNoMatch(reason: string): "no_match" | "error" {
  // Only a definitive catalog miss (or an unusable UPC) is terminal.
  if (reason.startsWith("No catalog item found")) return "no_match";
  if (reason.startsWith("invalid UPC")) return "no_match";
  return "error";
}

export async function matchPendingSupplierOffers(
  supplier: string,
  limit = 50
): Promise<MatchOffersResult> {
  const result: MatchOffersResult = {
    processed: 0,
    matched: 0,
    noMatch: 0,
    errored: 0,
    errors: [],
  };
  const cfg = spApiConfigFromEnv(process.env);
  if (!cfg) {
    result.errors.push("SP-API not configured — matching skipped.");
    return result;
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("supplier_offers")
    .select("id, supplier_sku, upc")
    .eq("supplier", supplier)
    .in("match_status", ["pending", "error"])
    .not("upc", "is", null)
    .order("first_seen_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 200)));
  if (error) {
    result.errors.push(`Could not read pending offers: ${error.message}`);
    return result;
  }
  const rows = (data ?? []) as OfferRow[];

  const throttle = new SpApiThrottle();
  const tokenCache = createTokenCache();
  const spFetch: typeof fetch = (input, init) => throttle.fetch(input, init, fetch);

  for (const row of rows) {
    result.processed++;
    try {
      const { match, reason } = await matchUpcToAsin(cfg, row.upc ?? "", spFetch, {
        tokenCache,
      });
      if (match) {
        const { error: upErr } = await admin
          .from("supplier_offers")
          .update({ matched_asin: match.asin, match_status: "matched" })
          .eq("id", row.id);
        if (upErr) {
          result.errored++;
          result.errors.push(`${row.supplier_sku}: ${upErr.message}`);
        } else {
          result.matched++;
        }
      } else {
        const status = classifyNoMatch(reason);
        const { error: upErr } = await admin
          .from("supplier_offers")
          .update({ match_status: status })
          .eq("id", row.id);
        if (upErr) {
          result.errored++;
          result.errors.push(`${row.supplier_sku}: ${upErr.message}`);
        } else if (status === "no_match") {
          result.noMatch++;
        } else {
          result.errored++;
          if (result.errors.length < 5) {
            result.errors.push(`${row.supplier_sku}: ${reason}`);
          }
        }
      }
    } catch (e) {
      result.errored++;
      result.errors.push(
        `${row.supplier_sku}: match failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pricing pass: for matched offers with no stored Amazon price, fetch the
// live Amazon landed price (same SP-API pricing client the verification
// scan uses) and store it with the estimated net/margin from the pure
// core. An unknown price is never stored as zero: the offer stays
// unpriced (amazon_price and priced_at stay null) — but the ATTEMPT is
// persisted (price_attempts / price_attempted_at, migration 024) and the
// selection policy in lib/suppliers/pricingCore.ts rotates the offer
// behind every fresher one, spaces retries by 24h, and removes it from
// the rotation after PRICE_ATTEMPT_MAX no-price attempts. Earlier this
// pass wrote nothing on a no-price lookup and re-selected by
// first_seen_at, so the same no-price offers head-of-line blocked every
// call (the Frontier drain livelock: processed=100 / priced +0 forever).
// ---------------------------------------------------------------------------

export interface PriceOffersResult {
  processed: number;
  priced: number;
  skipped: number;
  /** Unpriced offers held back by the per-offer attempt spacing gap. */
  deferred: number;
  /** Unpriced offers that used up their no-price attempt budget. */
  exhausted: number;
  errors: string[];
}

export async function priceMatchedSupplierOffers(
  supplier: string,
  cap = PRICE_SCAN_DEFAULT_CAP
): Promise<PriceOffersResult> {
  const result: PriceOffersResult = {
    processed: 0,
    priced: 0,
    skipped: 0,
    deferred: 0,
    exhausted: 0,
    errors: [],
  };
  const cfg = spApiConfigFromEnv(process.env);
  if (!cfg) {
    result.errors.push("SP-API not configured — pricing skipped.");
    return result;
  }
  const batchCap = Math.max(1, Math.min(cap, PRICE_SCAN_MAX_CAP));
  const admin = getSupabaseAdmin();
  const nowMs = Date.now();
  const spacingCutoffIso = new Date(nowMs - PRICE_ATTEMPT_SPACING_MS).toISOString();

  // Candidate pool: matched, has an ASIN, no stored price, attempt budget
  // left — least-recently-attempted first (never-attempted first), so
  // retries can never outrank fresh offers.
  const { data, error } = await admin
    .from("supplier_offers")
    .select(
      "id, supplier_sku, matched_asin, cost_price, product_class, subcategory, price_attempts, price_attempted_at"
    )
    .eq("supplier", supplier)
    .eq("match_status", "matched")
    .not("matched_asin", "is", null)
    .is("amazon_price", null)
    .lt("price_attempts", PRICE_ATTEMPT_MAX)
    .order("price_attempted_at", { ascending: true, nullsFirst: true })
    .order("first_seen_at", { ascending: true })
    .limit(batchCap * PRICE_SCAN_OVERSAMPLE);
  if (error) {
    result.errors.push(`Could not read matched offers: ${error.message}`);
    return result;
  }
  const rows = (data ?? []) as OfferRow[];

  // Exact pool-wide drain accounting, independent of the fetch window:
  // how many unpriced offers are waiting out their spacing gap, and how
  // many are out of the rotation for good.
  const poolBase = () =>
    admin
      .from("supplier_offers")
      .select("id", { count: "exact", head: true })
      .eq("supplier", supplier)
      .eq("match_status", "matched")
      .not("matched_asin", "is", null)
      .is("amazon_price", null);
  const [deferredRes, exhaustedRes] = await Promise.all([
    poolBase()
      .lt("price_attempts", PRICE_ATTEMPT_MAX)
      .gte("price_attempted_at", spacingCutoffIso),
    poolBase().gte("price_attempts", PRICE_ATTEMPT_MAX),
  ]);
  result.deferred = deferredRes.count ?? 0;
  result.exhausted = exhaustedRes.count ?? 0;

  const batch = pickPricingBatch(
    rows.map((row) => ({
      row,
      priceAttempts: typeof row.price_attempts === "number" ? row.price_attempts : 0,
      priceAttemptedAt: row.price_attempted_at ?? null,
    })),
    batchCap,
    nowMs
  );

  // Persist a no-price attempt so the offer rotates to the back of the
  // queue (and eventually out of it) instead of being re-picked first on
  // the next call. A stamp failure is surfaced, never hidden.
  const stampAttempt = async (candidate: (typeof batch)[number]): Promise<void> => {
    const { error: stampErr } = await admin
      .from("supplier_offers")
      .update({
        price_attempts: candidate.priceAttempts + 1,
        price_attempted_at: new Date().toISOString(),
      })
      .eq("id", candidate.row.id);
    if (stampErr) {
      result.errors.push(
        `${candidate.row.supplier_sku}: could not record pricing attempt: ${stampErr.message}`
      );
    }
  };

  // Pricing tolerates a tighter pace than Catalog lookups; the throttle
  // still backs off and retries on 429/5xx.
  const throttle = new SpApiThrottle({ minIntervalMs: 1000 });
  const spFetch: typeof fetch = (input, init) => throttle.fetch(input, init, fetch);

  for (const candidate of batch) {
    const row = candidate.row;
    result.processed++;
    try {
      const live = await getLiveSellPrice(cfg, row.matched_asin ?? "", spFetch);
      if (live.price === null) {
        result.skipped++;
        if (result.errors.length < 5) {
          result.errors.push(`${row.supplier_sku}: ${live.reason}`);
        }
        await stampAttempt(candidate);
        continue;
      }
      const estimate = estimateSupplierNet(
        {
          costPrice: Number(row.cost_price),
          productClass: row.product_class,
          subcategory: row.subcategory,
        },
        live.price
      );
      const { error: upErr } = await admin
        .from("supplier_offers")
        .update({
          amazon_price: live.price,
          est_net: estimate?.net ?? null,
          est_margin_pct: estimate?.marginPct ?? null,
          priced_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (upErr) {
        result.errors.push(`${row.supplier_sku}: ${upErr.message}`);
      } else {
        result.priced++;
      }
    } catch (e) {
      result.skipped++;
      result.errors.push(
        `${row.supplier_sku}: pricing failed: ${e instanceof Error ? e.message : String(e)}`
      );
      await stampAttempt(candidate);
    }
  }
  return result;
}
