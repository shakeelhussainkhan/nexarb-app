// Inventory health: days-of-supply tripwires from the 2026-10-10 research.
// Amazon monetises both ends — the low-inventory fee bites when 30d AND 90d
// supply are both under ~28 days; aged surcharges start at 181 days. The
// profitable corridor is roughly 28-180 days of supply.

export type InventoryStatus =
  | "stockout-risk" // < 28 days: low-inventory fee + lost sales risk
  | "healthy" // 28-90 days
  | "watch" // 91-150 days: sell-through must hold
  | "excess" // 151-180 days: markdown before the surcharge cliff
  | "aged-risk"; // > 180 days of supply or aged units: surcharges accrue

export interface InventoryHealth {
  daysOfSupply: number | null; // null when sell rate unknown
  status: InventoryStatus;
  reasons: string[];
}

export function daysOfSupply(unitsOnHand: number, avgDailySales: number): number | null {
  if (avgDailySales <= 0) return null;
  return unitsOnHand / avgDailySales;
}

export function inventoryHealth(
  unitsOnHand: number,
  avgDailySales: number,
  oldestUnitAgeDays = 0
): InventoryHealth {
  const dos = daysOfSupply(unitsOnHand, avgDailySales);
  const reasons: string[] = [];

  if (oldestUnitAgeDays >= 181) {
    reasons.push(`Oldest units are ${oldestUnitAgeDays}d old — aged-inventory surcharges apply on top of storage.`);
    return { daysOfSupply: dos, status: "aged-risk", reasons };
  }
  if (dos === null) {
    return {
      daysOfSupply: null,
      status: "watch",
      reasons: ["No sell-rate data yet — cannot compute days of supply."],
    };
  }

  let status: InventoryStatus;
  if (dos < 28) {
    status = "stockout-risk";
    reasons.push(`${Math.round(dos)} days of supply — below the ~28-day low-inventory threshold; reorder or raise price to slow burn.`);
  } else if (dos <= 90) {
    status = "healthy";
    reasons.push(`${Math.round(dos)} days of supply — inside the 28-180 day profitable corridor.`);
  } else if (dos <= 150) {
    status = "watch";
    reasons.push(`${Math.round(dos)} days of supply — above Amazon's 90-day excess line; sell-through must hold.`);
  } else if (dos <= 180) {
    status = "excess";
    reasons.push(`${Math.round(dos)} days of supply — markdown before day 181, when aged surcharges start.`);
  } else {
    status = "aged-risk";
    reasons.push(`${Math.round(dos)} days of supply — stock will cross the 181-day surcharge cliff before it clears.`);
  }
  if (oldestUnitAgeDays >= 150 && status !== "aged-risk") {
    reasons.push(`Oldest units are ${oldestUnitAgeDays}d old — surcharge cliff at 181d.`);
  }
  return { daysOfSupply: Math.round(dos * 10) / 10, status, reasons };
}

// Units to reorder to return to a target days-of-supply (0 when already there).
export function reorderQty(unitsOnHand: number, avgDailySales: number, targetDays = 45): number {
  if (avgDailySales <= 0) return 0;
  return Math.max(0, Math.ceil(avgDailySales * targetDays - unitsOnHand));
}
