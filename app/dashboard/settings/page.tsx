"use client";

import { useState } from "react";

type Toast = { msg: string; ok: boolean } | null;

function useToast() {
  const [toast, setToast] = useState<Toast>(null);
  function show(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }
  return { toast, show };
}

export default function SettingsPage() {
  const { toast, show } = useToast();

  // Account
  const [name, setName] = useState("Alex Johnson");
  const [email, setEmail] = useState("alex@example.com");

  // Amazon
  const [amzSellerId, setAmzSellerId] = useState("");
  const [amzMwsToken, setAmzMwsToken] = useState("");

  // Walmart
  const [walmartClientId, setWalmartClientId] = useState("");
  const [walmartSecret, setWalmartSecret] = useState("");

  // Notifications
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);

  // Filters
  const [minProfit, setMinProfit] = useState(20);
  const [minRoi, setMinRoi] = useState(30);
  const [maxBsr, setMaxBsr] = useState(50000);
  const [excludedCategories, setExcludedCategories] = useState<string[]>(["Adult", "Weapons"]);
  const [catInput, setCatInput] = useState("");

  async function saveSection(section: string) {
    await new Promise((r) => setTimeout(r, 600));
    show(`${section} saved successfully`);
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all"
          style={{ background: toast.ok ? "#0D1B2A" : "#FEE2E2", color: toast.ok ? "#fff" : "#DC2626" }}
        >
          {toast.ok ? "✓ " : "✗ "}{toast.msg}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
          Settings
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your account and integrations</p>
      </div>

      {/* Account */}
      <Section title="Account" description="Update your personal information">
        <div className="space-y-4">
          <Field label="Full Name" value={name} onChange={setName} />
          <Field label="Email" value={email} onChange={setEmail} type="email" />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Avatar</label>
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold"
                style={{ background: "#0D1B2A", color: "#B8922A" }}
              >
                {name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
              </div>
              <button className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition">
                Upload photo
              </button>
            </div>
          </div>
        </div>
        <SaveBtn onClick={() => saveSection("Account")} />
      </Section>

      {/* Amazon SP-API */}
      <Section title="Amazon SP-API" description="Connect your Amazon Seller account">
        <div className="space-y-4">
          <Field label="Seller ID" value={amzSellerId} onChange={setAmzSellerId} placeholder="A2JJKB8..." />
          <Field label="MWS Auth Token" value={amzMwsToken} onChange={setAmzMwsToken} placeholder="amzn.mws.xxxxxxxx" type="password" />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Marketplace</label>
            <select className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-[#B8922A]">
              <option>Amazon US</option>
              <option>Amazon CA</option>
              <option>Amazon UK</option>
            </select>
          </div>
        </div>
        <SaveBtn onClick={() => saveSection("Amazon SP-API")} />
      </Section>

      {/* Walmart API */}
      <Section title="Walmart API" description="Connect your Walmart Marketplace account">
        <div className="space-y-4">
          <Field label="Client ID" value={walmartClientId} onChange={setWalmartClientId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <Field label="Client Secret" value={walmartSecret} onChange={setWalmartSecret} placeholder="••••••••••••••••" type="password" />
        </div>
        <SaveBtn onClick={() => saveSection("Walmart API")} />
      </Section>

      {/* Notifications */}
      <Section title="Notifications" description="Control how and when NexArb alerts you">
        <div className="space-y-5">
          <Toggle
            label="Email Alerts"
            description="Receive deal summaries via email"
            checked={emailAlerts}
            onChange={setEmailAlerts}
          />
          <Toggle
            label="High Confidence Only"
            description="Only notify for AI Score ≥ 88"
            checked={highConfidenceOnly}
            onChange={setHighConfidenceOnly}
          />
          <div className="pt-2 space-y-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Telegram Bot</p>
            <Field label="Bot Token" value={telegramToken} onChange={setTelegramToken} placeholder="1234567890:AAF..." type="password" />
            <Field label="Chat ID" value={telegramChatId} onChange={setTelegramChatId} placeholder="-1001234567890" />
          </div>
        </div>
        <SaveBtn onClick={() => saveSection("Notifications")} />
      </Section>

      {/* Filters */}
      <Section title="Deal Filters" description="Control what deals NexArb surfaces">
        <div className="space-y-6">
          <SliderField label="Minimum Profit" value={minProfit} onChange={setMinProfit} min={5} max={200} display={`$${minProfit}`} />
          <SliderField label="Minimum ROI" value={minRoi} onChange={setMinRoi} min={10} max={200} display={`${minRoi}%`} />
          <SliderField label="Maximum BSR" value={maxBsr} onChange={setMaxBsr} min={1000} max={500000} step={1000} display={maxBsr.toLocaleString()} />

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Excluded Categories</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {excludedCategories.map((c) => (
                <span key={c} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-red-50 text-red-600">
                  {c}
                  <button onClick={() => setExcludedCategories((prev) => prev.filter((x) => x !== c))} className="hover:text-red-800">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={catInput}
                onChange={(e) => setCatInput(e.target.value)}
                placeholder="Add category…"
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#B8922A]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && catInput.trim()) {
                    setExcludedCategories((p) => [...p, catInput.trim()]);
                    setCatInput("");
                  }
                }}
              />
              <button
                onClick={() => { if (catInput.trim()) { setExcludedCategories((p) => [...p, catInput.trim()]); setCatInput(""); } }}
                className="px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
        <SaveBtn onClick={() => saveSection("Filters")} />
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-5" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
      <div className="mb-5 pb-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>{title}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
      />
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium" style={{ color: "#0D1B2A" }}>{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative shrink-0 w-11 h-6 rounded-full transition-all"
        style={{ background: checked ? "#0D1B2A" : "#E5E7EB" }}
      >
        <span
          className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, step = 1, display }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; display: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</label>
        <span className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#B8922A]" />
    </div>
  );
}

function SaveBtn({ onClick }: { onClick: () => void }) {
  const [saving, setSaving] = useState(false);
  async function handle() {
    setSaving(true);
    await onClick();
    setSaving(false);
  }
  return (
    <button
      onClick={handle}
      disabled={saving}
      className="mt-5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
      style={{ background: "#0D1B2A" }}
    >
      {saving ? "Saving…" : "Save changes"}
    </button>
  );
}
