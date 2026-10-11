// FIFO inventory accounting. Pure functions only — no I/O, no network, no secrets.
// Lots are consumed oldest-first by received_at; ties break on insertion order.

export interface InventoryLot {
  id: string;
  asin: string;
  qty: number;             // units purchased in this lot
  units_remaining: number; // not yet sold
  unit_cost: number;       // landed unit cost per unit, dollars
  source?: string | null;
  warehouse?: string | null;
  received_at?: string | null;
}

export interface SaleResult {
  cogs: number;            // cost of goods sold for this sale, dollars
  remainingLots: InventoryLot[]; // lots after consumption (input array is not mutated)
}

// Value of one lot's remaining units.
export function lotCost(lot: InventoryLot): number {
  return lot.unit_cost * lot.units_remaining;
}

// Append a lot. Does not mutate the input array.
export function addLot(lots: InventoryLot[], lot: InventoryLot): InventoryLot[] {
  if (lot.units_remaining > lot.qty) {
    throw new Error(`Lot ${lot.id} has units_remaining (${lot.units_remaining}) > qty (${lot.qty})`);
  }
  if (lot.units_remaining < 0 || lot.qty < 0 || lot.unit_cost < 0) {
    throw new Error(`Lot ${lot.id} has a negative qty or unit_cost`);
  }
  return [...lots, lot];
}

function oldestFirst(lots: InventoryLot[]): InventoryLot[] {
  return [...lots].sort((a, b) => {
    const ra = a.received_at ?? "";
    const rb = b.received_at ?? "";
    if (ra !== rb) return ra < rb ? -1 : 1;
    return 0; // stable sort keeps insertion order for identical timestamps
  });
}

// Sell qty units of an ASIN, consuming the oldest lots first (FIFO).
// Throws an Error on insufficient stock — never silently partial-sells.
export function sellUnits(lots: InventoryLot[], asin: string, qty: number): SaleResult {
  if (!Number.isInteger(qty) || qty < 0) {
    throw new Error(`qty must be a non-negative integer, got ${qty}`);
  }
  if (qty === 0) return { cogs: 0, remainingLots: lots.map((l) => ({ ...l })) };

  const ordered = oldestFirst(lots).map((l) => ({ ...l })); // deep-ish copy; input untouched
  let need = qty;
  let cogs = 0;

  for (const lot of ordered) {
    if (lot.asin !== asin || need <= 0) continue;
    const take = Math.min(lot.units_remaining, need);
    cogs += take * lot.unit_cost;
    lot.units_remaining -= take;
    need -= take;
  }

  if (need > 0) {
    const available = qty - need;
    throw new Error(
      `Insufficient stock for ASIN ${asin}: requested ${qty} units, only ${available} available. No units were consumed.`
    );
  }

  return { cogs, remainingLots: ordered };
}

// Aggregate a set of lots by ASIN: units on hand, weighted avg unit cost,
// oldest unit age in days (for aged-inventory surcharge math).
export interface AsinInventory {
  asin: string;
  unitsOnHand: number;
  avgUnitCost: number;
  oldestUnitAgeDays: number;
  lotCount: number;
  lots: InventoryLot[];
}

export function groupByAsin(lots: InventoryLot[], nowMs = Date.now()): AsinInventory[] {
  const byAsin = new Map<string, InventoryLot[]>();
  for (const lot of lots) {
    const arr = byAsin.get(lot.asin) ?? [];
    arr.push(lot);
    byAsin.set(lot.asin, arr);
  }
  const out: AsinInventory[] = [];
  for (const [asin, asinLots] of byAsin) {
    const unitsOnHand = asinLots.reduce((s, l) => s + l.units_remaining, 0);
    const costSum = asinLots.reduce((s, l) => s + l.unit_cost * l.units_remaining, 0);
    const receivedDates = asinLots
      .map((l) => (l.received_at ? Date.parse(l.received_at) : NaN))
      .filter((t) => !Number.isNaN(t));
    const oldestAgeDays =
      receivedDates.length === 0
        ? 0
        : Math.max(0, Math.floor((nowMs - Math.min(...receivedDates)) / 86400000));
    out.push({
      asin,
      unitsOnHand,
      avgUnitCost: unitsOnHand > 0 ? costSum / unitsOnHand : 0,
      oldestUnitAgeDays: oldestAgeDays,
      lotCount: asinLots.length,
      lots: asinLots,
    });
  }
  out.sort((a, b) => (a.asin < b.asin ? -1 : a.asin > b.asin ? 1 : 0));
  return out;
}
