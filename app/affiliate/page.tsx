"use client";

import { useState } from "react";
import Link from "next/link";

const PLANS = [
  { name: "Solo", price: 99, commission: 29.7 },
  { name: "Professional", price: 199, commission: 59.7 },
  { name: "Agency", price: 399, commission: 119.7 },
];

export default function AffiliatePage() {
  const [referrals, setReferrals] = useState(5);
  const [planIdx, setPlanIdx] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", promotion_method: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const monthly = referrals * PLANS[planIdx].commission;
  const annual = monthly * 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/affiliate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setReferralCode(data.referral_code);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to submit");
      setStatus("error");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "Inter, sans-serif" }}>
      {/* Nav */}
      <header style={{ borderBottom: "1px solid #F3F4F6", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <Link href="https://nexarb.io" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" fill="#B8922A" />
              <text x="32" y="40" textAnchor="middle" fill="#0D1B2A" fontSize="24" fontWeight="700" fontFamily="Georgia, serif">N</text>
            </svg>
            <span style={{ fontWeight: 600, color: "#0D1B2A", fontSize: 16, fontFamily: "var(--font-playfair, Georgia, serif)" }}>NexArb</span>
          </Link>
          <Link href="/dashboard" style={{ background: "#0D1B2A", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Dashboard</Link>
        </div>
      </header>

      {/* Hero */}
      <section style={{ background: "#0D1B2A", padding: "80px 24px 96px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
          <p style={{ color: "#B8922A", fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>Affiliate Program</p>
          <h1 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 700, color: "#fff", fontFamily: "var(--font-playfair,Georgia,serif)", margin: "0 0 20px", lineHeight: 1.15 }}>
            Earn 30% recurring<br />commission. Forever.
          </h1>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 18, lineHeight: 1.7, margin: 0 }}>
            Refer sellers to NexArb and earn 30% of every payment — every month — for as long as they&apos;re subscribed.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "80px 24px 48px" }}>
        <h2 style={{ textAlign: "center", fontSize: 28, fontWeight: 700, color: "#0D1B2A", fontFamily: "var(--font-playfair,Georgia,serif)", marginBottom: 48 }}>How it works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 24 }}>
          {[
            { n: "01", title: "Share your link", desc: "Get your unique referral link and share it with Amazon/Walmart sellers in your network." },
            { n: "02", title: "Friend subscribes", desc: "When someone signs up for NexArb through your link, they&apos;re tagged as your referral." },
            { n: "03", title: "You earn monthly", desc: "Collect 30% of every payment they make — automatically, for the lifetime of their subscription." },
          ].map((s) => (
            <div key={s.n} style={{ background: "#F9FAFB", borderRadius: 16, padding: "32px 28px", border: "1px solid #F3F4F6" }}>
              <p style={{ color: "#B8922A", fontWeight: 700, fontSize: 28, fontFamily: "var(--font-playfair,Georgia,serif)", margin: "0 0 16px" }}>{s.n}</p>
              <h3 style={{ fontWeight: 700, color: "#0D1B2A", fontSize: 17, margin: "0 0 10px" }}>{s.title}</h3>
              <p style={{ color: "#6B7280", fontSize: 14, lineHeight: 1.65, margin: 0 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Commission table */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 48px" }}>
        <div style={{ background: "#0D1B2A", borderRadius: 20, overflow: "hidden" }}>
          <div style={{ padding: "32px 40px 0" }}>
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 700, fontFamily: "var(--font-playfair,Georgia,serif)", margin: "0 0 4px" }}>Commission structure</h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: 0 }}>30% recurring on all plans</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 0 }}>
            {PLANS.map((plan, i) => (
              <div key={plan.name} style={{ padding: "32px 40px", borderTop: "1px solid rgba(255,255,255,0.1)", borderRight: i < 2 ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{plan.name}</p>
                <p style={{ color: "#B8922A", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>${plan.commission.toFixed(2)}<span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.4)" }}>/mo</span></p>
                <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: 0 }}>per referral</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Calculator */}
      <section style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px 80px" }}>
        <div style={{ background: "#F9FAFB", borderRadius: 20, padding: "40px 40px", border: "1px solid #F3F4F6" }}>
          <h2 style={{ fontWeight: 700, color: "#0D1B2A", fontSize: 22, fontFamily: "var(--font-playfair,Georgia,serif)", margin: "0 0 8px" }}>Earnings calculator</h2>
          <p style={{ color: "#6B7280", fontSize: 14, margin: "0 0 32px" }}>See how much you could earn</p>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 12 }}>
              <span>Number of referrals</span>
              <span style={{ color: "#B8922A" }}>{referrals}</span>
            </label>
            <input
              type="range" min={1} max={50} value={referrals}
              onChange={(e) => setReferrals(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#B8922A", height: 4 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>1</span>
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>50</span>
            </div>
          </div>

          <div style={{ marginBottom: 32 }}>
            <label style={{ fontSize: 14, fontWeight: 600, color: "#374151", display: "block", marginBottom: 10 }}>Average plan</label>
            <div style={{ display: "flex", gap: 8 }}>
              {PLANS.map((p, i) => (
                <button
                  key={p.name}
                  onClick={() => setPlanIdx(i)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                    borderColor: planIdx === i ? "#B8922A" : "#E5E7EB",
                    background: planIdx === i ? "#FEF3C7" : "#fff",
                    color: planIdx === i ? "#92400E" : "#6B7280",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #E5E7EB", textAlign: "center" }}>
              <p style={{ color: "#9CA3AF", fontSize: 13, margin: "0 0 8px" }}>Monthly earnings</p>
              <p style={{ fontSize: 32, fontWeight: 700, color: "#B8922A", margin: 0 }}>${monthly.toFixed(0)}</p>
            </div>
            <div style={{ background: "#0D1B2A", borderRadius: 12, padding: "20px 24px", textAlign: "center" }}>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, margin: "0 0 8px" }}>Annual earnings</p>
              <p style={{ fontSize: 32, fontWeight: 700, color: "#B8922A", margin: 0 }}>${annual.toFixed(0)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Application form */}
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "0 24px 96px" }} id="apply">
        {status === "success" ? (
          <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 20, padding: "48px 40px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontWeight: 700, color: "#166534", fontSize: 22, marginBottom: 12 }}>You&apos;re in!</h2>
            <p style={{ color: "#15803D", marginBottom: 20 }}>Check your email for your referral code and tracking link.</p>
            <div style={{ background: "#fff", border: "1px solid #BBF7D0", borderRadius: 12, padding: "16px 24px", display: "inline-block" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Your referral code</p>
              <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#B8922A", letterSpacing: "0.1em" }}>{referralCode}</p>
            </div>
          </div>
        ) : (
          <div style={{ background: "#F9FAFB", borderRadius: 20, padding: "40px 40px", border: "1px solid #F3F4F6" }}>
            <h2 style={{ fontWeight: 700, color: "#0D1B2A", fontSize: 22, fontFamily: "var(--font-playfair,Georgia,serif)", margin: "0 0 8px" }}>Join the affiliate program</h2>
            <p style={{ color: "#6B7280", fontSize: 14, margin: "0 0 32px" }}>Free to join. Commissions paid monthly.</p>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Full name</label>
                <input
                  required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Email address</label>
                <input
                  required type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: 28 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>How will you promote NexArb?</label>
                <textarea
                  value={form.promotion_method}
                  onChange={(e) => setForm({ ...form, promotion_method: e.target.value })}
                  placeholder="e.g. YouTube channel, email newsletter, Amazon seller community..."
                  rows={3}
                  style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>

              {status === "error" && (
                <p style={{ color: "#EF4444", fontSize: 14, marginBottom: 16 }}>{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                style={{ width: "100%", padding: "14px 0", background: "linear-gradient(135deg,#B8922A,#D4A843)", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer", opacity: status === "loading" ? 0.7 : 1 }}
              >
                {status === "loading" ? "Submitting…" : "Apply to join →"}
              </button>
            </form>
          </div>
        )}
      </section>

      <footer style={{ borderTop: "1px solid #F3F4F6", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>
          © 2026 NexArb. <Link href="https://nexarb.io" style={{ color: "#B8922A", textDecoration: "none" }}>nexarb.io</Link>
        </p>
      </footer>
    </div>
  );
}
