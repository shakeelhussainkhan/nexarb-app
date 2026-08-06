"use client";

import { useState } from "react";

const PLANS = [
  {
    name: "Starter",
    price: 99,
    current: true,
    features: ["Up to 500 deals/day", "Amazon + Walmart", "Email alerts", "7-day history"],
    color: "#E5E7EB",
    textColor: "#6B7280",
    btnStyle: { background: "#F3F4F6", color: "#374151" },
  },
  {
    name: "Professional",
    price: 199,
    current: false,
    features: ["Up to 2,000 deals/day", "All channels incl. Alibaba", "Telegram + Email", "30-day history", "Priority AI scoring", "API access"],
    color: "#B8922A",
    textColor: "#B8922A",
    btnStyle: { background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)", color: "#fff" },
    badge: "Most Popular",
  },
  {
    name: "Agency",
    price: 399,
    current: false,
    features: ["Unlimited deals/day", "All channels", "All alert types", "90-day history", "White-label reports", "Dedicated support", "Multi-account"],
    color: "#0D1B2A",
    textColor: "#0D1B2A",
    btnStyle: { background: "#0D1B2A", color: "#fff" },
  },
];

const USAGE = [
  { label: "Deals Scanned", used: 312, limit: 500, unit: "" },
  { label: "API Calls", used: 4820, limit: 10000, unit: "" },
  { label: "Channels Connected", used: 2, limit: 2, unit: "" },
];

const INVOICES = [
  { date: "Aug 1, 2026", amount: "$99.00", status: "Paid", id: "INV-0023" },
  { date: "Jul 1, 2026", amount: "$99.00", status: "Paid", id: "INV-0022" },
  { date: "Jun 1, 2026", amount: "$99.00", status: "Paid", id: "INV-0021" },
  { date: "May 1, 2026", amount: "$99.00", status: "Paid", id: "INV-0020" },
];

export default function BillingPage() {
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  async function handleUpgrade(plan: string) {
    setUpgrading(plan);
    await new Promise((r) => setTimeout(r, 1200));
    setUpgrading(null);
    setToast({ msg: `Stripe checkout would open for ${plan} plan`, ok: true });
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="p-6 lg:p-8">
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: "#0D1B2A", color: "#fff" }}
        >
          ✓ {toast.msg}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>
          Billing
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your subscription and invoices</p>
      </div>

      {/* Current Plan */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Current Plan</p>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold" style={{ color: "#0D1B2A" }}>Starter</h2>
              <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#F0FDF4", color: "#16A34A" }}>Active</span>
            </div>
            <p className="text-sm text-gray-400 mt-1">$99/month · Renews Sep 1, 2026</p>
          </div>
          <button
            className="text-sm text-red-400 hover:text-red-600 transition font-medium"
            onClick={() => setToast({ msg: "Cancellation flow would open here", ok: true })}
          >
            Cancel subscription
          </button>
        </div>

        {/* Usage */}
        <div className="mt-6 pt-5 border-t border-gray-100 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">This Month&apos;s Usage</p>
          {USAGE.map((u) => (
            <div key={u.label}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-gray-600">{u.label}</span>
                <span className="font-semibold" style={{ color: "#0D1B2A" }}>
                  {u.used.toLocaleString()}{u.unit} / {u.limit.toLocaleString()}{u.unit}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((u.used / u.limit) * 100, 100)}%`,
                    background: u.used / u.limit > 0.8 ? "#EF4444" : u.used / u.limit > 0.6 ? "#F59E0B" : "#0D1B2A",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="mb-6">
        <p className="text-sm font-semibold mb-4" style={{ color: "#0D1B2A" }}>Upgrade your plan</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="relative rounded-2xl border p-6 transition-all"
              style={{
                borderColor: plan.current ? plan.color : plan.name === "Professional" ? "#B8922A" : "#E5E7EB",
                boxShadow: plan.name === "Professional" ? "0 4px 24px rgba(184,146,42,0.15)" : "0 1px 12px rgba(13,27,42,0.05)",
                background: "#fff",
              }}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold text-white" style={{ background: "#B8922A" }}>
                  {plan.badge}
                </div>
              )}
              {plan.current && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#F3F4F6", color: "#6B7280" }}>
                  Current
                </div>
              )}
              <div className="mb-4">
                <h3 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>{plan.name}</h3>
                <div className="flex items-end gap-1 mt-2">
                  <span className="text-3xl font-bold" style={{ color: "#0D1B2A" }}>${plan.price}</span>
                  <span className="text-sm text-gray-400 mb-1">/mo</span>
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-500">
                    <span className="mt-0.5 shrink-0" style={{ color: "#16A34A" }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => !plan.current && handleUpgrade(plan.name)}
                disabled={plan.current || upgrading === plan.name}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
                style={plan.btnStyle as React.CSSProperties}
              >
                {plan.current ? "Current plan" : upgrading === plan.name ? "Loading…" : `Upgrade to ${plan.name}`}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Invoice History */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>Invoice History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {["Invoice", "Date", "Amount", "Status", ""].map((h) => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((inv, i) => (
                <tr key={inv.id} className="border-b border-gray-50" style={{ background: i % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                  <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{inv.id}</td>
                  <td className="px-5 py-3.5 text-gray-600">{inv.date}</td>
                  <td className="px-5 py-3.5 font-medium" style={{ color: "#0D1B2A" }}>{inv.amount}</td>
                  <td className="px-5 py-3.5">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "#F0FDF4", color: "#16A34A" }}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button className="text-xs font-medium transition" style={{ color: "#B8922A" }}>
                      Download PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
