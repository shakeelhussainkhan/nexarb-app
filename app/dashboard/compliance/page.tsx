"use client";

import { useCallback, useEffect, useState } from "react";

// /dashboard/compliance — the import-compliance console: product
// screening register, per-category document checklists, shipment/ISF
// tracking with broker filing packages, the document archive index,
// bond monitoring, and the importer's personal exception queue (the
// signatures and attestations the law does not let software do).

type ChecklistItemDef = {
  key: string;
  title: string;
  detail: string;
  owner: string;
  automation: "automated" | "broker_api" | "manual_by_law";
};

type Screening = {
  verdict: "clear" | "review" | "blocked";
  category: string;
  reasons: string[];
};

type Product = {
  id: string;
  title: string;
  supplier_name: string | null;
  asin: string | null;
  alibaba_product_id: string | null;
  category: string;
  hts_code: string | null;
  origin_country: string;
  screening_verdict: string;
  screening_reasons: string[];
  checklist_status: Record<string, string>;
};

type Shipment = {
  id: string;
  name: string;
  status: string;
  transport: string;
  etd: string | null;
  eta: string | null;
  isf_filed_at: string | null;
  entry_number: string | null;
  customs_value: number;
  duty_estimate: { total: number; effectiveRate: number } | null;
};

type Overview = {
  importer: { legalName: string | null; brokerName: string | null; bondProvider: string | null; bondAmount: number | null };
  bond: { required: number; sufficient: boolean; utilization: number; headroom: number } | null;
  productCounts: { clear: number; review: number; blocked: number };
  productTotal: number;
  exceptions: { kind: string; label: string }[];
  shipmentAlerts: { kind: string; label: string }[];
  expiringDocuments: { id: string; title: string; expires_at: string }[];
};

type FilingPackage = {
  readyToFile: boolean;
  blockers: string[];
  isf: { validation: { complete: boolean; missing: string[] }; deadlineNote: string };
  pga: { agency: string; requirement: string; product: string }[];
  legalNote: string;
};

const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  clear: { bg: "#D1FAE5", text: "#065F46", label: "Clear" },
  review: { bg: "#FEF3C7", text: "#92400E", label: "IP review" },
  blocked: { bg: "#FEE2E2", text: "#991B1B", label: "Blocked" },
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function CompliancePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [ov, pr, sh] = await Promise.all([
        fetch("/api/compliance/overview").then((r) => r.json()),
        fetch("/api/compliance/products").then((r) => r.json()),
        fetch("/api/compliance/shipments").then((r) => r.json()),
      ]);
      if (ov.success) setOverview(ov.overview);
      if (pr.success) setProducts(pr.products ?? []);
      if (sh.success) setShipments(sh.shipments ?? []);
    } catch {
      setNotice("Could not load compliance data — has migration 015 been run?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold" style={{ color: "#0D1B2A" }}>Import Compliance</h1>
        <p className="text-sm text-gray-500 mt-1">
          Screening, duties, documents and filings for goods imported into the USA. Software assembles and
          validates everything; a licensed broker transmits to CBP, and the items in your exception queue
          are the signatures and judgments the law reserves to you as importer of record.
        </p>
      </header>

      {notice && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FEF3C7", color: "#92400E" }}>{notice}</div>
      )}
      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {overview && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Products tracked" value={String(overview.productTotal)} sub={`${overview.productCounts.clear} clear · ${overview.productCounts.review} review · ${overview.productCounts.blocked} blocked`} />
          <SummaryCard label="Your exception queue" value={String(overview.exceptions.length)} sub="Importer-only actions pending" warn={overview.exceptions.length > 0} />
          <SummaryCard
            label="Customs bond"
            value={overview.bond ? money(overview.importer.bondAmount) : "Not set"}
            sub={overview.bond ? `${Math.round(overview.bond.utilization * 100)}% utilised · ${overview.bond.sufficient ? "sufficient" : "INSUFFICIENT"}` : "Add bond details below"}
            warn={overview.bond ? !overview.bond.sufficient : false}
          />
          <SummaryCard label="Shipment alerts" value={String(overview.shipmentAlerts.length)} sub="ISF deadlines at risk" warn={overview.shipmentAlerts.length > 0} />
        </section>
      )}

      {overview && overview.shipmentAlerts.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-1">
          <h2 className="text-sm font-semibold text-red-800">Deadline alerts</h2>
          {overview.shipmentAlerts.map((a, i) => (
            <p key={i} className="text-sm text-red-700">{a.label}</p>
          ))}
        </section>
      )}

      {overview && overview.exceptions.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-1">
          <h2 className="text-sm font-semibold text-amber-800">Your exception queue — only you can clear these</h2>
          {overview.exceptions.slice(0, 12).map((e, i) => (
            <p key={i} className="text-sm text-amber-700">{e.label}</p>
          ))}
        </section>
      )}

      <ScreeningTool onAdded={refresh} />
      <ProductsRegister products={products} onChanged={refresh} />
      <ShipmentsSection shipments={shipments} onChanged={refresh} />
      <ImporterProfile overview={overview} onSaved={refresh} />
    </div>
  );
}

function SummaryCard({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-xl font-semibold mt-1" style={{ color: warn ? "#991B1B" : "#0D1B2A" }}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

function ScreeningTool({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [supplier, setSupplier] = useState("");
  const [result, setResult] = useState<{ screening: Screening; checklist: ChecklistItemDef[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function runScreen() {
    setBusy(true);
    try {
      const res = await fetch("/api/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, supplierName: supplier || undefined }),
      });
      const data = await res.json();
      if (data.success) setResult({ screening: data.screening, checklist: data.checklist });
    } finally {
      setBusy(false);
    }
  }

  async function addToRegister() {
    setBusy(true);
    try {
      await fetch("/api/compliance/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, supplierName: supplier || undefined }),
      });
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  const v = result ? VERDICT_STYLE[result.screening.verdict] : null;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>Screen a product before you buy it</h2>
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product title (e.g. Kids Wooden Toy Kitchen Set)" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier (optional)" className="sm:w-56 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={runScreen} disabled={busy || !title.trim()} className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "#0D1B2A" }}>
          Screen
        </button>
      </div>
      {result && v && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: v.bg, color: v.text }}>{v.label}</span>
            <span className="text-xs text-gray-500">Category: {result.screening.category.replace(/_/g, " ")}</span>
            <span className="text-xs text-gray-500">{result.checklist.length} compliance items apply</span>
            <button onClick={addToRegister} disabled={busy} className="ml-auto text-xs font-medium underline" style={{ color: "#B8922A" }}>
              Add to register
            </button>
          </div>
          {result.screening.reasons.map((r, i) => (
            <p key={i} className="text-xs text-red-700">{r}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function ProductsRegister({ products, onChanged }: { products: Product[]; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [defs, setDefs] = useState<ChecklistItemDef[]>([]);

  async function toggleOpen(p: Product) {
    if (openId === p.id) {
      setOpenId(null);
      return;
    }
    setOpenId(p.id);
    const res = await fetch("/api/compliance/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: p.title, supplierName: p.supplier_name ?? undefined }),
    });
    const data = await res.json();
    if (data.success) setDefs(data.checklist ?? []);
  }

  async function setItemStatus(p: Product, key: string, status: string) {
    const next = { ...(p.checklist_status ?? {}), [key]: status };
    await fetch("/api/compliance/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, title: p.title, supplierName: p.supplier_name ?? undefined, asin: p.asin ?? undefined, htsCode: p.hts_code ?? undefined, originCountry: p.origin_country, checklistStatus: next }),
    });
    onChanged();
  }

  if (products.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>Product register</h2>
      {products.map((p) => {
        const v = VERDICT_STYLE[p.screening_verdict] ?? VERDICT_STYLE.clear;
        const done = Object.values(p.checklist_status ?? {}).filter((s) => s === "done" || s === "na").length;
        return (
          <div key={p.id} className="rounded-2xl border border-gray-200 bg-white p-4">
            <button onClick={() => toggleOpen(p)} className="w-full flex items-center gap-3 text-left flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0" style={{ background: v.bg, color: v.text }}>{v.label}</span>
              <span className="text-sm font-medium flex-1 min-w-40" style={{ color: "#0D1B2A" }}>{p.title}</span>
              <span className="text-xs text-gray-500">{p.category.replace(/_/g, " ")}</span>
              <span className="text-xs text-gray-500">HTS {p.hts_code ?? "—"}</span>
              <span className="text-xs text-gray-500">{done} items done</span>
            </button>
            {p.screening_reasons?.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {p.screening_reasons.map((r, i) => (
                  <p key={i} className="text-xs text-red-700">{r}</p>
                ))}
              </div>
            )}
            {openId === p.id && (
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                {defs.map((item) => {
                  const status = p.checklist_status?.[item.key] ?? "pending";
                  return (
                    <div key={item.key} className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: "#0D1B2A" }}>
                          {item.title}
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                            {item.automation === "manual_by_law" ? "Importer only" : item.automation === "broker_api" ? "Via broker" : "Automated"}
                          </span>
                        </p>
                        <p className="text-xs text-gray-500">{item.detail}</p>
                      </div>
                      <select
                        value={status}
                        onChange={(e) => setItemStatus(p, item.key, e.target.value)}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs shrink-0"
                      >
                        <option value="pending">Pending</option>
                        <option value="done">Done</option>
                        <option value="na">N/A</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function ShipmentsSection({ shipments, onChanged }: { shipments: Shipment[]; onChanged: () => void }) {
  const [form, setForm] = useState({ name: "", supplierName: "", etd: "", customsValue: "", mfnRate: "", list: "list3" });
  const [pkg, setPkg] = useState<{ id: string; data: FilingPackage } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await fetch("/api/compliance/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          supplierName: form.supplierName || undefined,
          etd: form.etd || undefined,
          customsValue: Number(form.customsValue) || 0,
          duty: { mfnRate: (Number(form.mfnRate) || 0) / 100, section301List: form.list },
        }),
      });
      setForm({ name: "", supplierName: "", etd: "", customsValue: "", mfnRate: "", list: "list3" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function loadPackage(id: string) {
    const res = await fetch(`/api/compliance/shipments/${id}/package`);
    const data = await res.json();
    if (data.success) setPkg({ id, data: data.package });
  }

  async function advance(s: Shipment, status: string) {
    await fetch(`/api/compliance/shipments/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onChanged();
  }

  const NEXT: Record<string, string> = {
    planning: "isf_due", isf_due: "isf_filed", isf_filed: "in_transit",
    in_transit: "entry_filed", entry_filed: "released", released: "delivered",
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>Shipments &amp; filings</h2>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-wrap gap-2 items-end">
        <label className="text-xs text-gray-500">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Oct spatula order" className="block mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">Supplier<input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} className="block mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">ETD (sailing)<input type="date" value={form.etd} onChange={(e) => setForm({ ...form, etd: e.target.value })} className="block mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">Customs value $<input value={form.customsValue} onChange={(e) => setForm({ ...form, customsValue: e.target.value })} placeholder="20000" className="block mt-1 w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">MFN rate %<input value={form.mfnRate} onChange={(e) => setForm({ ...form, mfnRate: e.target.value })} placeholder="5" className="block mt-1 w-20 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">§301 list
          <select value={form.list} onChange={(e) => setForm({ ...form, list: e.target.value })} className="block mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800">
            <option value="list1">List 1 — 25%</option>
            <option value="list2">List 2 — 25%</option>
            <option value="list3">List 3 — 25%</option>
            <option value="list4a">List 4A — 7.5%</option>
            <option value="none">None</option>
          </select>
        </label>
        <button onClick={create} disabled={busy || !form.name.trim()} className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50" style={{ background: "#0D1B2A" }}>Create shipment</button>
      </div>

      {shipments.map((s) => (
        <div key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium flex-1 min-w-40" style={{ color: "#0D1B2A" }}>{s.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{s.status.replace(/_/g, " ")}</span>
            <span className="text-xs text-gray-500">{s.transport}</span>
            <span className="text-xs text-gray-500">ETD {s.etd ?? "—"}</span>
            <span className="text-xs text-gray-500">ISF {s.isf_filed_at ? "filed" : "not filed"}</span>
            <span className="text-xs text-gray-500">Entry {s.entry_number ?? "—"}</span>
            {s.duty_estimate && <span className="text-xs text-gray-500">Duty+fees {money(s.duty_estimate.total)} ({Math.round(s.duty_estimate.effectiveRate * 1000) / 10}%)</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => loadPackage(s.id)} className="text-xs font-medium underline" style={{ color: "#B8922A" }}>Broker filing package</button>
            {NEXT[s.status] && (
              <button onClick={() => advance(s, NEXT[s.status])} className="text-xs font-medium underline text-gray-500">
                Advance to {NEXT[s.status].replace(/_/g, " ")}
              </button>
            )}
          </div>
          {pkg && pkg.id === s.id && (
            <div className="border-t border-gray-100 pt-2 space-y-1">
              <p className="text-xs font-medium" style={{ color: pkg.data.readyToFile ? "#065F46" : "#991B1B" }}>
                {pkg.data.readyToFile ? "Ready to hand to your broker." : "Not ready — blockers:"}
              </p>
              {pkg.data.blockers.map((b, i) => (
                <p key={i} className="text-xs text-red-700">{b}</p>
              ))}
              <p className="text-xs text-gray-500">{pkg.data.isf.deadlineNote}</p>
              {pkg.data.pga.map((p, i) => (
                <p key={i} className="text-xs text-gray-600"><strong>{p.agency}</strong> — {p.requirement} ({p.product})</p>
              ))}
              <p className="text-[11px] text-gray-400">{pkg.data.legalNote}</p>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function ImporterProfile({ overview, onSaved }: { overview: Overview | null; onSaved: () => void }) {
  const [form, setForm] = useState({ iorLegalName: "", brokerName: "", bondProvider: "", bondAmount: "", trailing: "" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (overview) {
      setForm({
        iorLegalName: overview.importer.legalName ?? "",
        brokerName: overview.importer.brokerName ?? "",
        bondProvider: overview.importer.bondProvider ?? "",
        bondAmount: overview.importer.bondAmount ? String(overview.importer.bondAmount) : "",
        trailing: "",
      });
    }
  }, [overview]);

  async function save() {
    await fetch("/api/compliance/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iorLegalName: form.iorLegalName || undefined,
        brokerName: form.brokerName || undefined,
        bondProvider: form.bondProvider || undefined,
        bondAmount: form.bondAmount ? Number(form.bondAmount) : undefined,
        trailingDutiesTaxesFees: form.trailing ? Number(form.trailing) : undefined,
      }),
    });
    setSaved(true);
    onSaved();
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>Importer profile</h2>
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-500">Importer of record (legal name)<input value={form.iorLegalName} onChange={(e) => setForm({ ...form, iorLegalName: e.target.value })} placeholder="Five S LLC" className="block mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">Customs broker<input value={form.brokerName} onChange={(e) => setForm({ ...form, brokerName: e.target.value })} placeholder="e.g. Flexport" className="block mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">Bond provider (surety)<input value={form.bondProvider} onChange={(e) => setForm({ ...form, bondProvider: e.target.value })} className="block mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">Bond amount $<input value={form.bondAmount} onChange={(e) => setForm({ ...form, bondAmount: e.target.value })} placeholder="50000" className="block mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
        <label className="text-xs text-gray-500">Trailing-12-month duties/taxes/fees $<input value={form.trailing} onChange={(e) => setForm({ ...form, trailing: e.target.value })} placeholder="0" className="block mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" /></label>
      </div>
      <button onClick={save} className="px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ background: "#0D1B2A" }}>Save profile</button>
      {saved && <span className="ml-2 text-xs text-green-700">Saved.</span>}
      <p className="text-[11px] text-gray-400">
        The bond must be at least 10% of trailing-12-month duties, taxes and fees (minimum $50,000). At 2026 China
        rates, a $50,000 bond supports roughly $500,000 of annual duty — the monitor watches utilisation.
      </p>
    </section>
  );
}
