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
