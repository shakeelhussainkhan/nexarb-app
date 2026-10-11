// Repricing rules engine (Phase 3 rules; execution wiring comes with SP-API
// inventory/listings access). Codifies the 2026-10-10 research:
//  - the floor is absolute — never chase a price war below break-even
//  - raise toward the ceiling when competition thins or supply runs low
//  - markdown ahead of the day-181 aged-surcharge cliff, not after it
//  - per-lot floors (different buy costs = different floors) — pass the lot's
//    own floorPrice in, never a blended one.

export interface RepricingInput {
  currentPrice: number;
  floorPrice: number; // this lot's fee-stack floor (pricing.ts)
  ceilingPrice?: number; // upper end of 90d Buy Box range when known
  competitorOffers: number; // comparable FBA offers incl. yours; 0/1 = alone
  amazonOnListing?: boolean;
  daysOfSupply: number | null;
  oldestUnitAgeDays?: number;
  maxStepPct?: number; // max move per repricing pass, default 5%
}

export type RepricingAction = "raise" | "lower" | "markdown" | "hold";

export interface RepricingDecision {
  action: RepricingAction;
  newPrice: number;
  reason: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function decideRepricing(input: RepricingInput): RepricingDecision {
  const step = input.maxStepPct ?? 0.05;
  const { currentPrice, floorPrice } = input;
  const ceiling = input.ceilingPrice ?? currentPrice;
  const age = input.oldestUnitAgeDays ?? 0;

  // Safety first: a price at/below floor is corrected before anything else.
  if (currentPrice < floorPrice) {
    return {
      action: "raise",
      newPrice: round2(floorPrice),
      reason: `Price $${currentPrice.toFixed(2)} is below this lot's floor $${floorPrice.toFixed(2)} — restored to floor.`,
    };
  }

  // Aged-stock exit: ahead of the 181d cliff, walk down toward (never below)
  // the floor so units clear before surcharges compound.
  if (age >= 150 || (input.daysOfSupply !== null && input.daysOfSupply > 180)) {
    const target = Math.max(floorPrice, currentPrice * (1 - step));
    if (target < currentPrice) {
      return {
        action: "markdown",
        newPrice: round2(target),
        reason: `Aged/excess stock (oldest ${age}d, ${input.daysOfSupply ?? "?"}d supply) — markdown toward floor before the day-181 surcharge cliff.`,
      };
    }
    return { action: "hold", newPrice: currentPrice, reason: "Already at floor — further cuts lose money; consider removal/liquidation instead." };
  }

  // Thin competition: hunt the ceiling.
  if (input.competitorOffers <= 1 && ceiling > currentPrice) {
    const target = Math.min(ceiling, currentPrice * (1 + step));
    if (target > currentPrice) {
      return { action: "raise", newPrice: round2(target), reason: "No comparable FBA competition — raising toward the 90-day ceiling." };
    }
  }

  // Low supply: slow the burn and capture margin (also dodges the
  // low-inventory fee zone) unless Amazon itself is on the listing.
  if (input.daysOfSupply !== null && input.daysOfSupply < 28 && !input.amazonOnListing) {
    const target = currentPrice * (1 + step);
    return { action: "raise", newPrice: round2(target), reason: `Only ${Math.round(input.daysOfSupply)} days of supply — raising to slow burn and protect margin.` };
  }

  // Crowded listing with comfortable supply: step down toward the floor to
  // win Buy Box share, but never through it.
  if (input.competitorOffers >= 5 && (input.daysOfSupply === null || input.daysOfSupply > 45)) {
    const target = Math.max(floorPrice, currentPrice * (1 - step));
    if (target < currentPrice) {
      return { action: "lower", newPrice: round2(target), reason: `${input.competitorOffers} competing offers — stepping down toward floor for Buy Box share (floor held).` };
    }
    return { action: "hold", newPrice: currentPrice, reason: "At floor in a crowded listing — holding; cutting further loses money." };
  }

  return { action: "hold", newPrice: currentPrice, reason: "Price inside floor/ceiling corridor with balanced supply — no move." };
}

// ── WS4: Buy Box list-price suggestion, price-monitor logging, auto-reprice stub ──
// Execution of any live price change is intentionally NOT implemented here.
// See maybeAutoreprice for the founder-approval gate.

// Structural interface for the sibling worker's ChannelEvaluation (being added
// to verdict.ts). Import nothing from verdict.ts — match this shape locally.
export interface ChannelEvaluationLike {
  sellPrice: number; // current observed sell/buy-box price for the channel
  floorPrice: number; // fee-stack break-even floor for the channel
  netProfit: number; // per-unit net profit at sellPrice
}

export interface ListPriceInput {
  buyBoxPrice: number | null; // current Buy Box price; null when unknown
  floorPrice: number; // fee-stack break-even floor (pricing.ts)
  channel: string; // e.g. "amazon" — carried for context, not math
}

export interface ListPriceSuggestion {
  suggested: number | null; // penny under the Buy Box, clamped to [floor, ceiling]
  floor: number;
  ceiling: number; // buyBox * 1.5 — documented, deliberately generous
  reasoning: string;
}

// Suggest a list price: penny under the current Buy Box, clamped to the
// [floor, ceiling] corridor. Never suggests below break-even.
export function suggestListPrice(input: ListPriceInput): ListPriceSuggestion {
  const floor = round2(input.floorPrice);
  const buyBox = input.buyBoxPrice;
  if (buyBox === null || buyBox === undefined || !(buyBox > 0)) {
    return {
      suggested: null,
      floor,
      ceiling: 0,
      reasoning: "no buy box data — cannot suggest a list price.",
    };
  }
  const ceiling = round2(buyBox * 1.5);
  if (buyBox < floor) {
    return {
      suggested: null,
      floor,
      ceiling,
      reasoning: `buy box below break-even — do not list ($${buyBox.toFixed(2)} < floor $${floor.toFixed(2)}).`,
    };
  }
  const suggested = round2(Math.min(Math.max(buyBox - 0.01, floor), ceiling));
  return {
    suggested,
    floor,
    ceiling,
    reasoning:
      suggested === floor
        ? `penny under Buy Box would breach floor — held at floor $${floor.toFixed(2)}.`
        : `$${suggested.toFixed(2)}: one penny under the $${buyBox.toFixed(2)} Buy Box, inside the floor $${floor.toFixed(2)} / ceiling $${ceiling.toFixed(2)} corridor.`,
  };
}

// Convenience wrapper: derive a list-price suggestion from a per-channel
// evaluation shape (verdict.ts sibling work) rather than raw numbers.
export function suggestListPriceFromEvaluation(
  evalLike: ChannelEvaluationLike,
  channel: string
): ListPriceSuggestion {
  return suggestListPrice({
    buyBoxPrice: evalLike.sellPrice, // spot sell price ≈ current Buy Box
    floorPrice: evalLike.floorPrice,
    channel,
  });
}

// Minimal structural supabase-admin so this stays testable offline.
export interface PriceMonitorAdminLike {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
}

export interface PriceMonitorRecord {
  asin: string;
  channel: string;
  ourPrice: number | null;
  buyBoxPrice: number | null;
}

// Log a price observation to price_monitor (migration 007_velocity_snapshots.sql,
// sibling-owned). Observability only — never throws.
export async function recordPriceMonitor(
  admin: PriceMonitorAdminLike,
  record: PriceMonitorRecord
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await admin.from("price_monitor").insert({
      asin: record.asin,
      channel: record.channel,
      our_price: record.ourPrice,
      buy_box_price: record.buyBoxPrice,
      checked_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface WatchlistRowLike {
  asin: string;
  channel?: string;
  autoreprice_enabled?: boolean | null;
  price_min?: number | null;
  price_max?: number | null;
}

export interface MaybeAutorepriceInput {
  watchlistRow: WatchlistRowLike;
  suggestedPrice: number; // e.g. from suggestListPrice().suggested
}

// REQUIRES FOUNDER-APPROVED BOUNDS — do not enable live price changes.
//
// STUB ONLY: computes what it WOULD have done and always returns "skipped".
// Nothing here calls SP-API; nothing changes a listing price. The bounds
// (autoreprice_enabled + price_min/price_max on the watchlist row) are read
// for validation only so the "would have" plan is realistic when the founder
// approves real bounds later.
export async function maybeAutoreprice(
  input: MaybeAutorepriceInput
): Promise<{ action: "skipped"; reason: string }> {
  const would = `$${input.suggestedPrice.toFixed(2)}`;
  const row = input.watchlistRow;
  const notes: string[] = [];

  if (!row.autoreprice_enabled) notes.push("autoreprice flag not enabled on watchlist row");
  if (row.price_min != null && input.suggestedPrice < row.price_min)
    notes.push(`suggested ${would} below price_min $${row.price_min.toFixed(2)} — would have held at floor/bound`);
  if (row.price_max != null && input.suggestedPrice > row.price_max)
    notes.push(`suggested ${would} above price_max $${row.price_max.toFixed(2)} — would have held at bound`);

  const detail = notes.length ? ` (${notes.join("; ")})` : "";
  return {
    action: "skipped",
    reason: `auto-reprice disabled pending founder-approved bounds — would have set ${would}${detail}`,
  };
}
