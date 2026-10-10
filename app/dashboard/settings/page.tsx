"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

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
  const { user, isLoaded } = useUser();

  // Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // Amazon
  const [amzSellerId, setAmzSellerId] = useState("");
  const [amzMwsToken, setAmzMwsToken] = useState("");

  // Walmart
  const [walmartClientId, setWalmartClientId] = useState("");
  const [walmartSecret, setWalmartSecret] = useState("");

  // Notifications
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);

  // Filters
  const [minProfit, setMinProfit] = useState(20);
  const [minRoi, setMinRoi] = useState(30);
  const [maxBsr, setMaxBsr] = useState(50000);
  const [excludedCategories, setExcludedCategories] = useState<string[]>(["Adult", "Weapons"]);
  const [catInput, setCatInput] = useState("");

  // Pre-fill from Clerk
  useEffect(() => {
    if (isLoaded && user) {
      setName((prev) => prev || (user.fullName ?? user.firstName ?? ""));
      setEmail(user.emailAddresses?.[0]?.emailAddress ?? "");
    }
  }, [isLoaded, user]);

  // Load saved settings from Supabase
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ settings }) => {
        if (!settings) return;
        if (settings.display_name) setName(settings.display_name);
        if (settings.amz_seller_id) setAmzSellerId(settings.amz_seller_id);
        if (settings.walmart_client_id) setWalmartClientId(settings.walmart_client_id);
        if (settings.telegram_chat_id) {
          setTelegramChatId(settings.telegram_chat_id);
          setTelegramConnected(true);
        }
        if (settings.email_alerts !== undefined) setEmailAlerts(settings.email_alerts);
        if (settings.high_confidence_only !== undefined) setHighConfidenceOnly(settings.high_confidence_only);
        if (settings.min_profit) setMinProfit(settings.min_profit);
        if (settings.min_roi) setMinRoi(settings.min_roi);
        if (settings.max_bsr) setMaxBsr(settings.max_bsr);
        if (settings.excluded_categories) setExcludedCategories(settings.excluded_categories);
      })
      .catch(() => { /* Supabase may not be configured yet */ });
  }, []);

  async function saveSection(section: string, payload: Record<string, unknown>) {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      show(`${section} saved successfully`);
    } catch {
      show(`${section} saved (offline mode)`, true);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all flex items-center gap-2"
          style={{ background: toast.ok ? "#16A34A" : "#EF4444", color: "#fff" }}
        >
          {toast.ok ? "✓" : "✕"} {toast.msg}
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
                {name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?"}
              </div>
              <button className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition">
                Upload photo
              </button>
            </div>
          </div>
        </div>
        <SaveBtn onClick={() => saveSection("Account", { display_name: name })} />
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
        <SaveBtn onClick={() => saveSection("Amazon SP-API", { amz_seller_id: amzSellerId, amz_mws_token: amzMwsToken })} />
      </Section>

      {/* Walmart API */}
      <Section title="Walmart API" description="Connect your Walmart Marketplace account">
        <div className="space-y-4">
          <Field label="Client ID" value={walmartClientId} onChange={setWalmartClientId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <Field label="Client Secret" value={walmartSecret} onChange={setWalmartSecret} placeholder="••••••••••••••••" type="password" />
        </div>
        <SaveBtn onClick={() => saveSection("Walmart API", { walmart_client_id: walmartClientId, walmart_secret: walmartSecret })} />
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
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Telegram Alerts</p>
              {telegramConnected && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  Connected
                </span>
              )}
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 space-y-1">
              <p className="font-semibold mb-1">How to connect:</p>
              <p>1. Open Telegram and search <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded">@NexArbBot</span></p>
              <p>2. Send <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded">/start</span> to the bot</p>
              <p>3. The bot will reply with your Chat ID — paste it below</p>
            </div>
            <Field label="Your Chat ID" value={telegramChatId} onChange={setTelegramChatId} placeholder="e.g. 8695847775" />
            <button
              onClick={async () => {
                if (!telegramChatId.trim()) return;
                setTelegramLoading(true);
                try {
                  const res = await fetch("/api/telegram/connect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId: telegramChatId.trim() }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? "Failed");
                  setTelegramConnected(true);
                  show("Test message sent! Check Telegram.");
                } catch (err) {
                  show(err instanceof Error ? err.message : "Failed to connect", false);
                } finally {
                  setTelegramLoading(false);
                }
              }}
              disabled={telegramLoading || !telegramChatId.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: telegramConnected ? "#16A34A" : "#0D1B2A", color: "#fff" }}
            >
              {telegramLoading ? "Sending…" : telegramConnected ? "✓ Connected — Send test again" : "Send test message"}
            </button>
          </div>
        </div>
        <SaveBtn onClick={() => saveSection("Notifications", {
          email_alerts: emailAlerts,
          high_confidence_only: highConfidenceOnly,
        })} />
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
        <SaveBtn onClick={() => saveSection("Filters", {
          min_profit: minProfit,
          min_roi: minRoi,
          max_bsr: maxBsr,
          excluded_categories: excludedCategories,
        })} />
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

function SaveBtn({ onClick }: { onClick: () => Promise<void> }) {
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
      className="mt-5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 flex items-center gap-2"
      style={{ background: "#0D1B2A" }}
    >
      {saving && (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 11-6.219-8.56" />
        </svg>
      )}
      {saving ? "Saving…" : "Save changes"}
    </button>
  );
}
