// SP-API Orders v2026-01-01 + Finances v0 — sales / fees / disbursement sync.
//
// Transport + Supabase writes for the Money module. All mapping rules
// live in the pure core (lib/spapi/financesCore.ts); this file only
// fetches, joins, and upserts.
//
// Auth: same LWA access-token exchange as lib/spapi/pricing.ts and
// lib/engine/eligibility.ts (x-amz-access-token header), config from
// spApiConfigFromEnv (single seller account per deployment).
//
// HONESTY RULES (founder policy):
//  - Fetch EVERYTHING before writing ANYTHING. If any SP-API call
//    fails — in particular a 403 / role denial on Orders or Finances —
//    the sync aborts, writes nothing, and returns the upstream error
//    verbatim in `errors`. A silent "0 orders" success would hide a
//    missing Finance role behind an empty P&L.
//  - Upserts are idempotent (migration 022 keys), so re-running a
//    window is safe and expected (cron cadence + overlapping windows).

import { getSupabaseAdmin } from "@/lib/supabase";
import type { SpApiConfig } from "@/lib/engine/eligibility";
import {
  applyFeesToRows,
  attributeFees,
  buildPayoutRows,
  buildSaleRows,
  extractFeeLines,
  mapOrders2026,
  resolveWindow,
  type SpEventGroupLite,
  type SpFinancialEventsLite,
  type SpOrder2026,
  type SpOrderItemLite,
  type SpOrderLite,
} from "./financesCore";

type FetchFn = typeof fetch;

async function getAccessToken(cfg: SpApiConfig, fetchFn: FetchFn): Promise<string> {
  const res = await fetchFn("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`LWA token exchange ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("LWA token exchange returned no access token");
  return data.access_token;
}

type SpGetResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One SP-API GET. On 429, waits and retries exactly once (Orders
 * v2026-01-01 and Finances v0 rate limits are low). Any other failure
 * returns the status + Amazon's own error body excerpt — never a
 * paraphrase.
 */
async function spApiGet(
  cfg: SpApiConfig,
  token: string,
  path: string,
  fetchFn: FetchFn,
  attempt = 0
): Promise<SpGetResult> {
  const endpoint = cfg.endpoint ?? "https://sellingpartnerapi-na.amazon.com";
  let res: Response;
  try {
    res = await fetchFn(`${endpoint}${path}`, {
      headers: { "x-amz-access-token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { ok: false, error: `SP-API GET ${path.split("?")[0]} failed (${e instanceof Error ? e.message : "unknown error"})` };
  }
  if (res.status === 429 && attempt === 0) {
    await sleep(1100);
    return spApiGet(cfg, token, path, fetchFn, 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `SP-API GET ${path.split("?")[0]} returned ${res.status}${body ? ` — ${body.slice(0, 400)}` : ""}`,
    };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: true, data };
}

interface Paged<T> {
  items: T[];
  truncated: boolean; // a NextToken remained when the page guard stopped us
}

/**
 * Orders v2026-01-01 `searchOrders` — one consolidated call replaces
 * v0's getOrders + per-order getOrderItems: items ride on each order
 * when `includedData` asks for them. FULFILLMENT carries the order
 * status and per-item fulfilled quantities; PROCEEDS carries the
 * per-item ITEM breakdown that maps to v0's ItemPrice. The response
 * body has NO `payload` wrapper (unlike v0) — it IS
 * { orders, pagination: { nextToken } }. Pages are translated to the
 * lite contract by the pure core (mapOrders2026) as they arrive.
 */
async function fetchOrders(
  cfg: SpApiConfig,
  token: string,
  window: { fromIso: string; toIso: string },
  maxPages: number,
  fetchFn: FetchFn
): Promise<
  | { ok: true; orders: SpOrderLite[]; items: SpOrderItemLite[]; truncated: boolean }
  | { ok: false; error: string }
> {
  const orders: SpOrderLite[] = [];
  const items: SpOrderItemLite[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({
      marketplaceIds: cfg.marketplaceId,
      createdAfter: window.fromIso,
      createdBefore: window.toIso,
      fulfillmentStatuses: "SHIPPED,PARTIALLY_SHIPPED",
      includedData: "FULFILLMENT,PROCEEDS",
      maxResultsPerPage: "100",
    });
    if (nextToken) qs.set("paginationToken", nextToken);
    const res = await spApiGet(cfg, token, `/orders/2026-01-01/orders?${qs}`, fetchFn);
    if (!res.ok) return res;
    const body = res.data as unknown as { orders?: SpOrder2026[]; pagination?: { nextToken?: string } };
    const mapped = mapOrders2026(body.orders ?? []);
    orders.push(...mapped.orders);
    items.push(...mapped.items);
    nextToken = body.pagination?.nextToken;
    pages++;
  } while (nextToken && pages < maxPages);
  return { ok: true, orders, items, truncated: Boolean(nextToken) };
}

async function fetchFinancialEvents(
  cfg: SpApiConfig,
  token: string,
  window: { fromIso: string; toIso: string },
  maxPages: number,
  fetchFn: FetchFn
): Promise<{ ok: true; page: Paged<SpFinancialEventsLite> } | { ok: false; error: string }> {
  const merged: SpFinancialEventsLite = { ShipmentEventList: [], RefundEventList: [] };
  let count = 0;
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({
      PostedAfter: window.fromIso,
      PostedBefore: window.toIso,
      MaxResultsPerPage: "100",
    });
    if (nextToken) qs.set("NextToken", nextToken);
    const res = await spApiGet(cfg, token, `/finances/v0/financialEvents?${qs}`, fetchFn);
    if (!res.ok) return res;
    const payload = (res.data.payload ?? {}) as { FinancialEvents?: SpFinancialEventsLite; NextToken?: string };
    const ev = payload.FinancialEvents ?? {};
    merged.ShipmentEventList!.push(...(ev.ShipmentEventList ?? []));
    merged.RefundEventList!.push(...(ev.RefundEventList ?? []));
    count += (ev.ShipmentEventList ?? []).length + (ev.RefundEventList ?? []).length;
    nextToken = payload.NextToken;
    pages++;
  } while (nextToken && pages < maxPages);
  return { ok: true, page: { items: count > 0 || pages > 0 ? [merged] : [], truncated: Boolean(nextToken) } };
}

async function fetchEventGroups(
  cfg: SpApiConfig,
  token: string,
  window: { fromIso: string; toIso: string },
  maxPages: number,
  fetchFn: FetchFn
): Promise<{ ok: true; page: Paged<SpEventGroupLite> } | { ok: false; error: string }> {
  const items: SpEventGroupLite[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({
      FinancialEventGroupStartedAfter: window.fromIso,
      FinancialEventGroupStartedBefore: window.toIso,
      MaxResultsPerPage: "100",
    });
    if (nextToken) qs.set("NextToken", nextToken);
    const res = await spApiGet(cfg, token, `/finances/v0/financialEventGroups?${qs}`, fetchFn);
    if (!res.ok) return res;
    const payload = (res.data.payload ?? {}) as { FinancialEventGroupList?: SpEventGroupLite[]; NextToken?: string };
    items.push(...(payload.FinancialEventGroupList ?? []));
    nextToken = payload.NextToken;
    pages++;
  } while (nextToken && pages < maxPages);
  return { ok: true, page: { items, truncated: Boolean(nextToken) } };
}

export interface SyncFinancesOptions {
  days?: number;
  from?: string;
  to?: string;
  maxPages?: number;
  maxOrders?: number;
}

export interface SyncFinancesResult {
  ok: boolean;
  ordersSeen: number;
  salesUpserted: number;
  payoutsUpserted: number;
  windowFrom: string;
  windowTo: string;
  errors: string[];
  warnings: string[];
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_ORDERS = 250;

/**
 * Run one bounded ingestion pass. Fetches orders (items embedded via
 * searchOrders) → financial events → event groups; only when EVERY
 * fetch succeeded does it write (idempotent upserts). Any SP-API
 * failure aborts with the upstream error in `errors` and zero writes.
 */
export async function syncFinances(
  cfg: SpApiConfig,
  opts: SyncFinancesOptions = {},
  fetchFn: FetchFn = fetch,
  now: Date = new Date()
): Promise<SyncFinancesResult> {
  const window = resolveWindow(now, opts);
  const base: SyncFinancesResult = {
    ok: false,
    ordersSeen: 0,
    salesUpserted: 0,
    payoutsUpserted: 0,
    windowFrom: window.fromIso,
    windowTo: window.toIso,
    errors: [],
    warnings: [],
  };
  const maxPages = Math.min(100, Math.max(1, Math.trunc(opts.maxPages ?? DEFAULT_MAX_PAGES) || DEFAULT_MAX_PAGES));
  const maxOrders = Math.min(2000, Math.max(1, Math.trunc(opts.maxOrders ?? DEFAULT_MAX_ORDERS) || DEFAULT_MAX_ORDERS));

  let token: string;
  try {
    token = await getAccessToken(cfg, fetchFn);
  } catch (e) {
    return { ...base, errors: [`SP-API auth failed: ${e instanceof Error ? e.message : "unknown error"}`] };
  }

  // --- Fetch phase (no writes yet) -------------------------------------------
  const ordersRes = await fetchOrders(cfg, token, window, maxPages, fetchFn);
  if (!ordersRes.ok) return { ...base, errors: [ordersRes.error] };
  const allOrders = ordersRes.orders;
  base.ordersSeen = allOrders.length;
  if (ordersRes.truncated) {
    base.warnings.push(`Orders list truncated at ${maxPages} pages — narrow the window or raise maxPages.`);
  }
  const orders = allOrders.slice(0, maxOrders);
  if (allOrders.length > orders.length) {
    base.warnings.push(`Processing the first ${orders.length} of ${allOrders.length} orders (maxOrders cap); re-run to continue.`);
  }

  // Items arrive embedded in each order (searchOrders includedData) —
  // there are no per-order item calls anymore. Items belonging to
  // orders beyond the maxOrders cap drop out with their orders.
  const processedOrderIds = new Set(orders.map((o) => o.AmazonOrderId));
  const allItems = ordersRes.items.filter((it) => it.AmazonOrderId && processedOrderIds.has(it.AmazonOrderId));
  const asinByOrderItemId: Record<string, string> = {};
  const asinBySku: Record<string, string> = {};
  for (const it of allItems) {
    if (it.OrderItemId && it.ASIN) asinByOrderItemId[it.OrderItemId] = it.ASIN;
    if (it.SellerSKU && it.ASIN) asinBySku[it.SellerSKU] = it.ASIN;
  }

  const eventsRes = await fetchFinancialEvents(cfg, token, window, maxPages, fetchFn);
  if (!eventsRes.ok) return { ...base, errors: [eventsRes.error] };
  if (eventsRes.page.truncated) {
    base.warnings.push(`Financial events truncated at ${maxPages} pages — fees may be partial for this window.`);
  }
  const groupsRes = await fetchEventGroups(cfg, token, window, maxPages, fetchFn);
  if (!groupsRes.ok) return { ...base, errors: [groupsRes.error] };
  if (groupsRes.page.truncated) {
    base.warnings.push(`Financial event groups truncated at ${maxPages} pages — payouts may be partial for this window.`);
  }

  // --- Build phase (pure core) -------------------------------------------------
  const { rows: saleRows, stats } = buildSaleRows(orders, allItems);
  const feeLines = extractFeeLines(eventsRes.page.items[0] ?? {});
  const attribution = attributeFees(saleRows, feeLines, asinByOrderItemId, asinBySku);
  const finalSales = applyFeesToRows(saleRows, attribution.feesByKey);
  const payouts = buildPayoutRows(groupsRes.page.items);

  if (stats.itemsMissingAsin + stats.itemsZeroQty + stats.itemsMissingPrice > 0) {
    base.warnings.push(
      `Order items skipped: ${stats.itemsMissingAsin} missing ASIN, ${stats.itemsZeroQty} zero shipped qty, ${stats.itemsMissingPrice} missing price.`
    );
  }
  if (attribution.unattributedLines > 0) {
    base.warnings.push(
      `${attribution.unattributedLines} fee line(s) could not be attributed to a sale row in this window (signed sum $${attribution.unattributedSignedAmount.toFixed(2)}).`
    );
  }
  if (attribution.clampedKeys.length > 0) {
    base.warnings.push(
      `${attribution.clampedKeys.length} sale row(s) had net fee credits exceeding charges; fees clamped to $0 per the sales_events CHECK.`
    );
  }
  if (payouts.skippedNoId + payouts.skippedNoAmount > 0) {
    base.warnings.push(
      `Event groups skipped: ${payouts.skippedNoId} missing group id, ${payouts.skippedNoAmount} missing amount.`
    );
  }

  // --- Write phase (idempotent upserts) ------------------------------------------
  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const salesDbRows = finalSales.map((r) => ({
    asin: r.asin,
    qty: r.qty,
    unit_price: r.unitPrice,
    fees: r.fees,
    sold_at: r.soldAt,
    amazon_order_id: r.amazonOrderId,
  }));
  for (let i = 0; i < salesDbRows.length; i += 500) {
    const chunk = salesDbRows.slice(i, i + 500);
    const { data, error } = await admin
      .from("sales_events")
      .upsert(chunk, { onConflict: "amazon_order_id,asin" })
      .select("id");
    if (error) {
      return {
        ...base,
        errors: [`sales_events upsert failed: ${error.message} (a partial write is possible — re-running is safe, upserts are idempotent)`],
      };
    }
    base.salesUpserted += data?.length ?? chunk.length;
  }

  const payoutDbRows = payouts.rows.map((p) => ({
    id: p.id,
    amazon_group_id: p.amazonGroupId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    posted_at: p.postedAt,
    bank_tail: p.bankTail,
    raw: p.raw as Record<string, unknown>,
    updated_at: nowIso,
  }));
  for (let i = 0; i < payoutDbRows.length; i += 500) {
    const chunk = payoutDbRows.slice(i, i + 500);
    const { data, error } = await admin
      .from("payouts")
      .upsert(chunk, { onConflict: "amazon_group_id" })
      .select("id");
    if (error) {
      return {
        ...base,
        errors: [`payouts upsert failed: ${error.message} (sales rows from this run are already written; re-running is safe)`],
      };
    }
    base.payoutsUpserted += data?.length ?? chunk.length;
  }

  return { ...base, ok: true };
}
