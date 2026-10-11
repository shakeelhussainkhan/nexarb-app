import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";

// Force request-time rendering: this page reads Supabase with server-side
// secrets that are not available (placeholders) during `next build`.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Automated 3PL ops tracker. MANUAL PORTAL WORKFLOW — Automated 3PL has NO API.
// Every action on this page is an operator recording what they did in the
// portal. No purchasing, no money movement happens here; invoices are tracked
// (paid by card in the portal), not paid.
// ---------------------------------------------------------------------------

// Status lifecycle (mirrored in supabase/migrations/005_inventory_pnl_warehouse.sql).
// NOTE: scripts/verify-inventory.mjs mirrors this map — keep the two in sync.
export const SHIPMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  created: ["in_transit", "cancelled"],
  in_transit: ["received_at_warehouse", "cancelled"],
  received_at_warehouse: ["prepping", "cancelled"],
  prepping: ["shipped_to_amazon", "cancelled"],
  shipped_to_amazon: ["delivered_to_amazon", "cancelled"],
  delivered_to_amazon: [], // terminal
  cancelled: [],           // terminal
};

export function canTransitionShipment(from: string, to: string): boolean {
  return (SHIPMENT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  created: "Created",
  in_transit: "In transit",
  received_at_warehouse: "Received at warehouse",
  prepping: "Prepping",
  shipped_to_amazon: "Shipped to Amazon",
  delivered_to_amazon: "Delivered to Amazon",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  created: { bg: "#F5F3FF", color: "#7C3AED" },
  in_transit: { bg: "#EFF6FF", color: "#2563EB" },
  received_at_warehouse: { bg: "#F0FDF4", color: "#16A34A" },
  prepping: { bg: "#FFFBEB", color: "#D97706" },
  shipped_to_amazon: { bg: "#FFF7ED", color: "#EA580C" },
  delivered_to_amazon: { bg: "#ECFDF5", color: "#047857" },
  cancelled: { bg: "#F9FAFB", color: "#9CA3AF" },
};

interface ShipmentRow {
  id: string;
  retailer_order_ref: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status: string;
  vault_receipt_confirmed: boolean;
  vault_received_at: string | null;
  fba_shipment_id: string | null;
  outbound_status: string | null;
  invoice_amount: number | null;
  invoice_paid: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function supabaseReady(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function sb() {
  return getSupabaseAdmin();
}

// --- Server actions --------------------------------------------------------

async function createShipment(formData: FormData) {
  "use server";
  const row = {
    retailer_order_ref: String(formData.get("retailer_order_ref") ?? "").trim() || null,
    tracking_number: String(formData.get("tracking_number") ?? "").trim() || null,
    carrier: String(formData.get("carrier") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  const { error } = await sb().from("warehouse_shipments").insert(row);
  if (error) throw new Error(`Could not log shipment: ${error.message}`);
  revalidatePath("/dashboard/warehouse");
}

async function advanceStatus(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const to = String(formData.get("to"));
  const { data, error } = await sb().from("warehouse_shipments").select("status").eq("id", id).single();
  if (error || !data) throw new Error("Shipment not found.");
  const from = (data as { status: string }).status;
  if (!canTransitionShipment(from, to)) {
    throw new Error(`Cannot move a shipment from "${from}" to "${to}".`);
  }
  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };
  if (to === "received_at_warehouse") {
    patch.vault_receipt_confirmed = true;
    patch.vault_received_at = new Date().toISOString();
  }
  const { error: upErr } = await sb().from("warehouse_shipments").update(patch).eq("id", id);
  if (upErr) throw new Error(`Could not update status: ${upErr.message}`);
  revalidatePath("/dashboard/warehouse");
}

async function setFbaShipmentId(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const fbaId = String(formData.get("fba_shipment_id") ?? "").trim();
  if (!fbaId) throw new Error("Enter the Amazon Seller Central shipment ID first.");
  const { error } = await sb()
    .from("warehouse_shipments")
    .update({ fba_shipment_id: fbaId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not save FBA shipment ID: ${error.message}`);
  revalidatePath("/dashboard/warehouse");
}

async function recordInvoice(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const amountRaw = String(formData.get("invoice_amount") ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    throw new Error("Invoice amount must be a non-negative number.");
  }
  const { error } = await sb()
    .from("warehouse_shipments")
    .update({
      invoice_amount: amount,
      invoice_paid: formData.get("invoice_paid") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Could not record invoice: ${error.message}`);
  revalidatePath("/dashboard/warehouse");
}

async function addNote(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return;
  const { data } = await sb().from("warehouse_shipments").select("notes").eq("id", id).single();
  const existing = (data as { notes: string | null } | null)?.notes ?? "";
  const stamped = `[${new Date().toISOString()}] ${note}`;
  const notes = existing ? `${existing}\n${stamped}` : stamped;
  const { error } = await sb()
    .from("warehouse_shipments")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not add note: ${error.message}`);
  revalidatePath("/dashboard/warehouse");
}

// --- Page ------------------------------------------------------------------

export default async function WarehousePage() {
  let shipments: ShipmentRow[] = [];
  let loadError = "";
  if (!supabaseReady()) {
    loadError = "Supabase is not configured in this environment, so no shipments are shown.";
  } else {
    try {
      const { data, error } = await sb()
        .from("warehouse_shipments")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      shipments = (data ?? []) as ShipmentRow[];
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Shipments could not be loaded.";
    }
  }

  const open = shipments.filter((s) => !["delivered_to_amazon", "cancelled"].includes(s.status));
  const unpaid = shipments.filter((s) => s.invoice_amount !== null && !s.invoice_paid);
  const unpaidTotal = unpaid.reduce((s, r) => s + Number(r.invoice_amount ?? 0), 0);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
          Warehouse Ops — Automated 3PL
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Manual portal workflow tracker · Automated 3PL has <strong>no API</strong> — log each step here as you complete it in their portal
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>How this works:</strong> create the vault shipment in the Automated 3PL portal first (retailer order ASINs + quantities),
        then log it below. When their email confirms vault receipt, advance the status here. Create the FBA shipment in Seller
        Central, paste the shipment ID here, and record the prep invoice when you pay it by card in the portal.
        Nothing here purchases anything or moves money.
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {loadError} We never substitute sample data.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        {[
          ["Open shipments", String(open.length)],
          ["Unpaid prep invoices", `$${unpaidTotal.toFixed(2)} (${unpaid.length})`],
          ["Total tracked", String(shipments.length)],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white rounded-2xl border border-gray-100 p-4" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
            <p className="text-2xl font-semibold mt-1" style={{ color: "#0D1B2A" }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Log a new inbound shipment */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "#0D1B2A" }}>Log a new inbound shipment (after creating the vault shipment in the portal)</h2>
        <form action={createShipment} className="flex flex-wrap gap-3">
          <input name="retailer_order_ref" type="text" placeholder="Retailer order ref (e.g. Walmart #123456)" className="flex-1 min-w-48 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300" />
          <input name="tracking_number" type="text" placeholder="Inbound tracking #" className="flex-1 min-w-40 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300" />
          <input name="carrier" type="text" placeholder="Carrier" className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300" />
          <input name="notes" type="text" placeholder="Notes (ASINs, quantities…)" className="flex-1 min-w-48 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A] placeholder:text-gray-300" />
          <button type="submit" className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#0D1B2A" }}>
            Log shipment
          </button>
        </form>
      </div>

      {/* Shipments table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {["Shipment", "Inbound", "Status", "FBA shipment ID", "Invoice", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#9CA3AF" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shipments.map((s, i) => {
                const st = STATUS_STYLES[s.status] ?? { bg: "#F9FAFB", color: "#6B7280" };
                const nexts = SHIPMENT_STATUS_TRANSITIONS[s.status] ?? [];
                return (
                  <tr key={s.id} className="border-b border-gray-50 align-top" style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                    <td className="px-4 py-3.5">
                      <span className="font-medium" style={{ color: "#0D1B2A" }}>{s.retailer_order_ref ?? "—"}</span>
                      <span className="block text-[11px] text-gray-400">logged {new Date(s.created_at).toLocaleDateString()}</span>
                      {s.vault_received_at && (
                        <span className="block text-[11px] text-green-600 mt-0.5">vault confirmed {new Date(s.vault_received_at).toLocaleDateString()}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-gray-600 text-xs">
                      {s.tracking_number ?? "—"}
                      {s.carrier && <span className="block text-gray-400">{s.carrier}</span>}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: st.bg, color: st.color }}>
                        {SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
                      </span>
                      {s.outbound_status && <span className="block text-[11px] text-gray-400 mt-1 max-w-48 whitespace-normal">{s.outbound_status}</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <form action={setFbaShipmentId} className="flex gap-1.5">
                        <input type="hidden" name="id" value={s.id} />
                        <input
                          name="fba_shipment_id"
                          type="text"
                          defaultValue={s.fba_shipment_id ?? ""}
                          placeholder="FBA shipment ID"
                          className="w-36 rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#B8922A] placeholder:text-gray-300"
                        />
                        <button type="submit" className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50">Save</button>
                      </form>
                    </td>
                    <td className="px-4 py-3.5">
                      <form action={recordInvoice} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={s.id} />
                        <input
                          name="invoice_amount"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={s.invoice_amount !== null ? String(s.invoice_amount) : ""}
                          placeholder="$"
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#B8922A] placeholder:text-gray-300"
                        />
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          <input type="checkbox" name="invoice_paid" defaultChecked={s.invoice_paid} className="rounded accent-[#0D1B2A]" /> paid
                        </label>
                        <button type="submit" className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50">Save</button>
                      </form>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {nexts.map((to) => (
                          <form key={to} action={advanceStatus}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="to" value={to} />
                            <button
                              type="submit"
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                            >
                              {to === "in_transit" && "→ In transit"}
                              {to === "received_at_warehouse" && "✓ Confirm vault receipt"}
                              {to === "prepping" && "→ Prepping"}
                              {to === "shipped_to_amazon" && "→ Shipped to Amazon"}
                              {to === "delivered_to_amazon" && "✓ Delivered to Amazon"}
                              {to === "cancelled" && "✕ Cancel"}
                            </button>
                          </form>
                        ))}
                        {nexts.length === 0 && <span className="text-xs text-gray-300">terminal</span>}
                      </div>
                      <form action={addNote} className="flex gap-1.5 mt-2">
                        <input type="hidden" name="id" value={s.id} />
                        <input name="note" type="text" placeholder="Add note…" className="flex-1 min-w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#B8922A] placeholder:text-gray-300" />
                        <button type="submit" className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-500 hover:bg-gray-50">Add</button>
                      </form>
                      {s.notes && (
                        <details className="mt-1.5">
                          <summary className="text-[11px] text-gray-400 cursor-pointer">notes ({s.notes.split("\n").length})</summary>
                          <pre className="text-[11px] text-gray-500 whitespace-pre-wrap mt-1 max-w-64">{s.notes}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shipments.length === 0 && !loadError && (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No warehouse shipments logged yet.</p>
            <p className="text-gray-400 text-xs mt-1">Create the vault shipment in the Automated 3PL portal, then log it above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
