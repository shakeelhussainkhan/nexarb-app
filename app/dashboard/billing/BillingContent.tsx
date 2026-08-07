"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

const PLANS = [
  {
    name: "Solo",
    priceId: "price_1U1vBNEkm3bbs6z6zN4sE4yS",
    price: 99,
    planKey: "solo",
    features: ["Up to 500 deals/day", "Amazon + Walmart", "Email alerts", "7-day history"],
    color: "#E5E7EB",
    textColor: "#6B7280",
    btnStyle: { background: "#F3F4F6", color: "#374151" },
  },
  {
    name: "Professional",
    priceId: "price_1U1vCjEkm3bbs6z6MYO2It39",
    price: 199,
    planKey: "professional",
    features: ["Up to 2,000 deals/day", "All channels incl. Alibaba", "Telegram + Email", "30-day history", "Priority AI scoring", "API access"],
    color: "#B8922A",
    textColor: "#B8922A",
    btnStyle: { background: "linear-gradient(135deg, #B8922A 0%, #D4A843 100%)", color: "#fff" },
    badge: "Most Popular",
  },
  {
    name: "Agency",
    priceId: "price_1U1vDYEkm3bbs6z6h2RtUp0E",
    price: 399,
    planKey: "agency",
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

interface Subscription {
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
}

function trialDaysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days > 0 ? days : null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function BillingPage() {
  const { user, isLoaded } = useUser();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loadingSub, setLoadingSub] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    fetch("/api/stripe/subscription")
      .then((r) => r.json())
      .then(({ subscription: sub }) => setSubscription(sub))
      .catch(() => setSubscription(null))
      .finally(() => setLoadingSub(false));
  }, [isLoaded]);

  async function handleUpgrade(plan: typeof PLANS[0]) {
    if (!user) return;
    setUpgrading(plan.name);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: plan.priceId,
          userId: user.id,
          email: user.primaryEmailAddress?.emailAddress ?? "",
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setToast({ msg: data.error ?? "Something went wrong", ok: false });
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      setToast({ msg: "Failed to start checkout", ok: false });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setUpgrading(null);
    }
  }

  const activePlan = subscription?.plan ?? "free";
  const isTrialing = subscription?.status === "trialing";
  const trialDays = trialDaysRemaining(subscription?.trial_ends_at ?? null);

  const currentPlanMeta = PLANS.find((p) => p.planKey === activePlan);
  const renewsLabel = isTrialing && subscription?.trial_ends_at
    ? `Trial ends ${formatDate(subscription.trial_ends_at)}`
    : subscription?.current_period_end
    ? `Renews ${formatDate(subscription.current_period_end)}`
    : null;

  return (
    <div className="p-6 lg:p-8">
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: toast.ok ? "#0D1B2A" : "#EF4444", color: "#fff" }}
        >
          {toast.ok ? "✓" : "✕"} {toast.msg}
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
              <h2 className="text-xl font-semibold" style={{ color: "#0D1B2A" }}>
                {loadingSub ? "Loading…" : currentPlanMeta?.name ?? "Free"}
              </h2>
              {!loadingSub && subscription && (
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={
                    isTrialing
                      ? { background: "#FEF3C7", color: "#D97706" }
                      : { background: "#F0FDF4", color: "#16A34A" }
                  }
                >
                  {isTrialing ? "Trialing" : subscription.status === "active" ? "Active" : subscription.status}
                </span>
              )}
            </div>
            {!loadingSub && (
              <p className="text-sm text-gray-400 mt-1">
                {currentPlanMeta ? `$${currentPlanMeta.price}/month` : "Free"}
                {renewsLabel ? ` · ${renewsLabel}` : ""}
              </p>
            )}
            {isTrialing && trialDays !== null && (
              <p className="text-xs font-medium mt-1.5" style={{ color: "#D97706" }}>
                {trialDays} day{trialDays !== 1 ? "s" : ""} remaining in trial
              </p>
            )}
          </div>
          {subscription?.stripe_subscription_id && (
            <button
              className="text-sm text-red-400 hover:text-red-600 transition font-medium"
              onClick={() => setToast({ msg: "Manage subscription via Stripe customer portal", ok: true })}
            >
              Cancel subscription
            </button>
          )}
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
        <p className="text-sm font-semibold mb-4" style={{ color: "#0D1B2A" }}>
          {activePlan === "free" ? "Choose a plan" : "Upgrade your plan"}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.planKey === activePlan;
            return (
              <div
                key={plan.name}
                className="relative rounded-2xl border p-6 transition-all"
                style={{
                  borderColor: isCurrent ? plan.color : plan.name === "Professional" ? "#B8922A" : "#E5E7EB",
                  boxShadow: plan.name === "Professional" ? "0 4px 24px rgba(184,146,42,0.15)" : "0 1px 12px rgba(13,27,42,0.05)",
                  background: "#fff",
                }}
              >
                {plan.badge && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold text-white" style={{ background: "#B8922A" }}>
                    {plan.badge}
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#F0FDF4", color: "#16A34A" }}>
                    Current Plan
                  </div>
                )}
                <div className="mb-4">
                  <h3 className="text-base font-semibold" style={{ color: "#0D1B2A" }}>{plan.name}</h3>
                  <div className="flex items-end gap-1 mt-2">
                    <span className="text-3xl font-bold" style={{ color: "#0D1B2A" }}>${plan.price}</span>
                    <span className="text-sm text-gray-400 mb-1">/mo</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">14-day free trial</p>
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
                  onClick={() => !isCurrent && handleUpgrade(plan)}
                  disabled={isCurrent || upgrading === plan.name || !isLoaded}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
                  style={isCurrent ? { background: "#F3F4F6", color: "#6B7280" } : (plan.btnStyle as React.CSSProperties)}
                >
                  {isCurrent
                    ? "Current plan"
                    : upgrading === plan.name
                    ? "Redirecting…"
                    : `Get started with ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoice History */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden" style={{ boxShadow: "0 1px 12px 0 rgba(13,27,42,0.05)" }}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>Invoice History</h2>
        </div>
        <div className="px-6 py-10 text-center text-sm text-gray-400">
          Invoices will appear here after your first payment.
        </div>
      </div>
    </div>
  );
}
