import { groupByAsin, lotCost, type InventoryLot } from "@/lib/engine/fifo";
import { inventoryHealth, type InventoryStatus } from "@/lib/engine/inventory";
import { getSupabaseAdmin } from "@/lib/supabase";

const STATUS_STYLES: Record<InventoryStatus, { bg: string; color: string; label: string }> = {
  "stockout-risk": { bg: "#FEF2F2", color: "#DC2626", label: "Stockout risk" },
  healthy: { bg: "#F0FDF4", color: "#16A34A", label: "Healthy" },
  watch: { bg: "#FFFBEB", color: "#D97706", label: "Watch" },
  excess: { bg: "#FFF7ED", color: "#EA580C", label: "Excess" },
  "aged-risk": { bg: "#FDF2F8", color: "#BE185D", label: "Aged risk" },
};

function supabaseReady(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export default async function InventoryPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const rawVelo = typeof sp.velo === "string" ? sp.velo : "";
  const parsedVelo = Number.parseFloat(rawVelo);
  const dailyVelocity = Number.isFinite(parsedVelo) && parsedVelo > 0 ? parsedVelo : null;

  let lots: InventoryLot[] | null = null; // null = could not load
  let loadError = "";
  if (!supabaseReady()) {
    loadError = "Supabase is not configured in this environment, so no inventory is shown.";
  } else {
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb.from("inventory_lots").select("*").order("received_at", { ascending: true });
      if (error) throw new Error(error.message);
      lots = (data ?? []) as InventoryLot[];
    } catch (e) {
      loadError =
        e instanceof Error ? e.message : "Inventory could not be loaded.";
    }
  }

  const groups = lots ? groupByAsin(lots) : [];
  const totalUnits = groups.reduce((s, g) => s + g.unitsOnHand, 0);
  const totalValue = lots ? lots.reduce((s, l) => s + lotCost(l), 0) : 0;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
          Inventory
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          FIFO lots grouped by ASIN · days-of-supply state reuses the inventory-health engine ·
          only real recorded lots appear here
        </p>
      </div>

      {/* Velocity estimate */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="velo" className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              Estimated daily units sold (per ASIN)
            </label>
            <input
              id="velo"
              name="velo"
              type="number"
              step="0.1"
              min="0"
              defaultValue={rawVelo}
              placeholder="unknown"
              className="w-40 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300"
            />
          </div>
          <button type="submit" className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#0D1B2A" }}>
            Apply
          </button>
          {dailyVelocity === null ? (
            <p className="text-xs text-gray-400 pb-2.5">
              No sell-rate entered — days-of-supply shows <strong>unknown</strong>. Enter an estimate to get tripwire states.
            </p>
          ) : (
            <p className="text-xs text-gray-400 pb-2.5">
              Applying <strong>{dailyVelocity}/day</strong> to every ASIN until per-ASIN velocity data is wired — treat as a rough estimate.
            </p>
          )}
        </form>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {loadError} We never substitute sample data.
        </div>
      )}

      {lots !== null && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            {[
              ["Units on hand", totalUnits.toLocaleString()],
              ["Inventory value (at cost)", `$${totalValue.toFixed(2)}`],
              ["ASINs tracked", String(groups.length)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
                <p className="text-2xl font-semibold mt-1" style={{ color: "#0D1B2A" }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Per-ASIN table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {["ASIN", "Lots", "On hand", "Avg unit cost", "Value", "Est daily vel", "Days of supply", "State"].map((h) => (
                      <th key={h} className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#9CA3AF" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => {
                    const health = inventoryHealth(g.unitsOnHand, dailyVelocity ?? 0, g.oldestUnitAgeDays);
                    const style = STATUS_STYLES[health.status];
                    return (
                      <tr key={g.asin} className="border-b border-gray-50 hover:bg-gray-50/60" style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                        <td className="px-4 py-3.5 font-medium" style={{ color: "#0D1B2A" }}>{g.asin}</td>
                        <td className="px-4 py-3.5 text-gray-600">{g.lotCount}</td>
                        <td className="px-4 py-3.5 text-gray-600">{g.unitsOnHand}</td>
                        <td className="px-4 py-3.5 text-gray-600">${g.avgUnitCost.toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-gray-600">${g.lots.reduce((s, l) => s + lotCost(l), 0).toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-gray-500">{dailyVelocity === null ? "unknown" : `${dailyVelocity}/day`}</td>
                        <td className="px-4 py-3.5 text-gray-500">{health.daysOfSupply === null ? "—" : `~${health.daysOfSupply}d`}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: style.bg, color: style.color }}>
                            {style.label}
                          </span>
                          <span className="block text-[11px] text-gray-400 mt-1 max-w-56 whitespace-normal">{health.reasons[0]}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {groups.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-gray-400 text-sm">No inventory lots yet.</p>
                <p className="text-gray-400 text-xs mt-1">Log a retailer purchase as a lot (insert into <code>inventory_lots</code>) to start tracking.</p>
              </div>
            )}
          </div>

          {/* Per-lot detail */}
          {groups.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
              <div className="px-4 py-3.5 border-b border-gray-100">
                <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>Lots (FIFO order)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["ASIN", "Bought", "Remaining", "Unit cost", "Source", "Warehouse", "Received"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#9CA3AF" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((g) =>
                      g.lots.map((l) => (
                        <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                          <td className="px-4 py-3 font-medium" style={{ color: "#0D1B2A" }}>{l.asin}</td>
                          <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                          <td className="px-4 py-3 font-semibold" style={{ color: l.units_remaining === 0 ? "#9CA3AF" : "#0D1B2A" }}>{l.units_remaining}</td>
                          <td className="px-4 py-3 text-gray-600">${Number(l.unit_cost).toFixed(2)}</td>
                          <td className="px-4 py-3 text-gray-500">{l.source ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-500">{l.warehouse ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{l.received_at ? new Date(l.received_at).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
