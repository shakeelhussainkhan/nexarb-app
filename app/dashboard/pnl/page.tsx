import { sellUnits, lotCost, type InventoryLot } from "@/lib/engine/fifo";
import { getSupabaseAdmin } from "@/lib/supabase";

interface SaleRow {
  id: string;
  asin: string;
  qty: number;
  unit_price: number;
  fees: number;
  sold_at: string | null;
}

interface AsinPnl {
  asin: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  fees: number;
  profit: number;
  marginPct: number | null;
  cogsError: string | null; // set when sales exceed recorded lots
}

function supabaseReady(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export default async function PnlPage() {
  let lots: InventoryLot[] | null = null;
  let sales: SaleRow[] | null = null;
  let loadError = "";

  if (!supabaseReady()) {
    loadError = "Supabase is not configured in this environment, so no P&L data is shown.";
  } else {
    try {
      const sb = getSupabaseAdmin();
      const [lotsRes, salesRes] = await Promise.all([
        sb.from("inventory_lots").select("*"),
        sb.from("sales_events").select("*").order("sold_at", { ascending: true, nullsFirst: true }),
      ]);
      if (lotsRes.error) throw new Error(`inventory_lots: ${lotsRes.error.message}`);
      if (salesRes.error) throw new Error(`sales_events: ${salesRes.error.message}`);
      lots = (lotsRes.data ?? []) as InventoryLot[];
      sales = (salesRes.data ?? []) as SaleRow[];
    } catch (e) {
      loadError = e instanceof Error ? e.message : "P&L data could not be loaded.";
    }
  }

  // FIFO: consume lots in sold_at order. Working copy keeps lots in received_at order;
  // sellUnits already consumes oldest-first internally.
  const pnl: AsinPnl[] = [];
  const remainingByAsin = new Map<string, { lots: InventoryLot[]; cogsError: string | null }>();
  if (lots && sales) {
    const lotPool = lots.map((l) => ({ ...l }));
    const salesByAsin = new Map<string, SaleRow[]>();
    for (const s of sales) {
      const arr = salesByAsin.get(s.asin) ?? [];
      arr.push(s);
      salesByAsin.set(s.asin, arr);
    }
    const asins = new Set([...salesByAsin.keys(), ...lotPool.map((l) => l.asin)]);
    for (const asin of asins) {
      const asinSales = salesByAsin.get(asin) ?? [];
      const revenue = asinSales.reduce((s, r) => s + r.qty * Number(r.unit_price), 0);
      const fees = asinSales.reduce((s, r) => s + Number(r.fees), 0);
      const unitsSold = asinSales.reduce((s, r) => s + r.qty, 0);
      let cogs = 0;
      let cogsError: string | null = null;
      let pool = lotPool;
      for (const sale of asinSales) {
        try {
          const res = sellUnits(pool, asin, sale.qty);
          cogs += res.cogs;
          pool = res.remainingLots;
        } catch (e) {
          cogsError =
            e instanceof Error ? e.message : `COGS cannot be computed for ${asin}: sales exceed recorded lots.`;
          break;
        }
      }
      remainingByAsin.set(asin, { lots: pool.filter((l) => l.asin === asin), cogsError });
      const profit = revenue - cogs - fees;
      pnl.push({
        asin,
        unitsSold,
        revenue,
        cogs,
        fees,
        profit,
        marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
        cogsError,
      });
    }
    pnl.sort((a, b) => (a.asin < b.asin ? -1 : a.asin > b.asin ? 1 : 0));
  }

  const totals = pnl.reduce(
    (t, p) => ({
      revenue: t.revenue + p.revenue,
      cogs: t.cogs + p.cogs,
      fees: t.fees + p.fees,
      profit: t.profit + p.profit,
    }),
    { revenue: 0, cogs: 0, fees: 0, profit: 0 }
  );

  const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
          P&amp;L
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Revenue − FIFO COGS − fees, per ASIN · COGS consumes lots oldest-first · only real recorded sales and lots
        </p>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {loadError} We never substitute sample data.
        </div>
      )}

      {lots !== null && sales !== null && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {[
              ["Revenue", totals.revenue],
              ["FIFO COGS", totals.cogs],
              ["Fees", totals.fees],
              ["Net profit", totals.profit],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-white rounded-2xl border border-gray-100 p-4" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
                <p className="text-2xl font-semibold mt-1" style={{ color: (label as string) === "Net profit" ? (value as number) >= 0 ? "#16A34A" : "#DC2626" : "#0D1B2A" }}>
                  {money(value as number)}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {["ASIN", "Units sold", "Revenue", "FIFO COGS", "Fees", "Net profit", "Margin"].map((h) => (
                      <th key={h} className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#9CA3AF" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pnl.map((p, i) => (
                    <tr key={p.asin} className="border-b border-gray-50 hover:bg-gray-50/60" style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                      <td className="px-4 py-3.5 font-medium" style={{ color: "#0D1B2A" }}>{p.asin}</td>
                      <td className="px-4 py-3.5 text-gray-600">{p.unitsSold}</td>
                      <td className="px-4 py-3.5 text-gray-600">{money(p.revenue)}</td>
                      <td className="px-4 py-3.5 text-gray-600">
                        {p.cogsError ? <span className="text-amber-600 text-xs font-medium">cannot compute</span> : money(p.cogs)}
                      </td>
                      <td className="px-4 py-3.5 text-gray-600">{money(p.fees)}</td>
                      <td className="px-4 py-3.5 font-semibold whitespace-nowrap" style={{ color: p.profit >= 0 ? "#16A34A" : "#DC2626" }}>{money(p.profit)}</td>
                      <td className="px-4 py-3.5 text-gray-500">{p.marginPct === null ? "—" : `${p.marginPct.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pnl.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-gray-400 text-sm">No sales or inventory lots yet.</p>
                <p className="text-gray-400 text-xs mt-1">Record lots in <code>inventory_lots</code> and sales in <code>sales_events</code> to see P&amp;L.</p>
              </div>
            )}
          </div>

          {pnl.some((p) => p.cogsError) && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Some ASINs have sales that exceed their recorded lots, so COGS (and net profit) are incomplete for them:
              <ul className="list-disc ml-5 mt-1">
                {pnl.filter((p) => p.cogsError).map((p) => (
                  <li key={p.asin}><strong>{p.asin}</strong> — {p.cogsError}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Remaining lots after FIFO consumption */}
          {pnl.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
              <div className="px-4 py-3.5 border-b border-gray-100">
                <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>Lots remaining after FIFO consumption</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["ASIN", "Bought", "Remaining", "Unit cost", "Remaining value"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#9CA3AF" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.flatMap((p) =>
                      (remainingByAsin.get(p.asin)?.lots ?? []).map((l) => (
                        <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                          <td className="px-4 py-3 font-medium" style={{ color: "#0D1B2A" }}>{l.asin}</td>
                          <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                          <td className="px-4 py-3 text-gray-600">{l.units_remaining}</td>
                          <td className="px-4 py-3 text-gray-600">${Number(l.unit_cost).toFixed(2)}</td>
                          <td className="px-4 py-3 text-gray-600">${lotCost(l).toFixed(2)}</td>
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
