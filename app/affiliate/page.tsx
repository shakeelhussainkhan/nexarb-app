"use client";

import { useState } from "react";
import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import Reveal from "@/components/Reveal";
import GoldParticles from "@/components/GoldParticles";

const PLANS = [
  { name: "Solo", price: 99, commission: 29.7 },
  { name: "Professional", price: 199, commission: 59.7 },
  { name: "Agency", price: 399, commission: 119.7 },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "#fff",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "rgba(255,255,255,0.6)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

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
    <div style={{ background: "#070B16", color: "#fff", minHeight: "100vh", overflowX: "clip" }}>
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ padding: "160px 24px 100px" }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 20%, rgba(184,146,42,0.16) 0%, transparent 65%)",
          }}
        />
        <GoldParticles count={22} />
        <div className="relative" style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <Reveal>
            <p className="nx-section-label">Affiliate Program</p>
            <h1
              className="font-display mt-5"
              style={{ fontSize: "clamp(38px, 6vw, 68px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.01em" }}
            >
              Earn <span className="nx-gold-text">30% recurring</span>
              <br />
              commission. Forever.
            </h1>
            <p className="mt-6 text-lg" style={{ color: "rgba(255,255,255,0.62)", lineHeight: 1.7, maxWidth: 560, margin: "24px auto 0" }}>
              Refer sellers to NexArb and earn 30% of every payment — every month — for as long as they&apos;re subscribed.
            </p>
            <a
              href="#apply"
              className="nx-btn-gold inline-block mt-9 font-bold px-8 py-4 rounded-xl"
              style={{ color: "#0A0F1E", textDecoration: "none" }}
            >
              Apply now →
            </a>
          </Reveal>
        </div>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px 80px" }}>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { n: "01", title: "Share your link", desc: "Get your unique referral link and share it with Amazon and Walmart sellers in your network." },
            { n: "02", title: "They subscribe", desc: "When someone joins NexArb through your link, they're tagged as your referral automatically." },
            { n: "03", title: "You earn monthly", desc: "Collect 30% of every payment they make — for the lifetime of their subscription." },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="nx-card-dark rounded-2xl p-8 h-full">
                <p className="font-display font-bold mb-5" style={{ fontSize: 40, color: "rgba(184,146,42,0.4)" }}>{s.n}</p>
                <h3 className="font-bold mb-3" style={{ color: "#fff", fontSize: 17 }}>{s.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Commission structure */}
      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px 80px" }}>
        <Reveal>
          <div
            className="rounded-3xl overflow-hidden relative"
            style={{ border: "1px solid rgba(184,146,42,0.3)", background: "linear-gradient(160deg, rgba(184,146,42,0.1) 0%, rgba(10,15,30,0.6) 60%)" }}
          >
            <div className="px-10 pt-10">
              <h2 className="font-display font-bold" style={{ fontSize: 26, color: "#fff" }}>Commission structure</h2>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>30% recurring on all plans · paid monthly</p>
            </div>
            <div className="grid sm:grid-cols-3 mt-8" style={{ borderTop: "1px solid rgba(184,146,42,0.2)" }}>
              {PLANS.map((plan, i) => (
                <div
                  key={plan.name}
                  className="px-10 py-9"
                  style={{ borderRight: i < 2 ? "1px solid rgba(184,146,42,0.15)" : "none" }}
                >
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "rgba(255,255,255,0.45)" }}>{plan.name} · ${plan.price}/mo</p>
                  <p className="font-bold" style={{ fontSize: 36, color: "#E8C766" }}>
                    ${plan.commission.toFixed(2)}
                    <span className="text-sm font-normal" style={{ color: "rgba(255,255,255,0.4)" }}>/mo</span>
                  </p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>per active referral</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* Calculator */}
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px 90px" }}>
        <Reveal>
          <div className="nx-card-dark rounded-3xl p-10">
            <h2 className="font-display font-bold" style={{ fontSize: 26, color: "#fff" }}>Earnings calculator</h2>
            <p className="text-sm mt-1.5 mb-9" style={{ color: "rgba(255,255,255,0.5)" }}>Drag the slider. Watch the math.</p>

            <div className="mb-8">
              <label className="flex justify-between text-sm font-semibold mb-4" style={{ color: "rgba(255,255,255,0.75)" }}>
                <span>Number of referrals</span>
                <span className="font-mono font-bold" style={{ color: "#E8C766", fontSize: 18 }}>{referrals}</span>
              </label>
              <input
                type="range" min={1} max={50} value={referrals}
                onChange={(e) => setReferrals(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: "#D4A843", height: 6, cursor: "pointer" }}
              />
              <div className="flex justify-between mt-2">
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>1</span>
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>50</span>
              </div>
            </div>

            <div className="mb-9">
              <label className="text-sm font-semibold block mb-3" style={{ color: "rgba(255,255,255,0.75)" }}>Average plan</label>
              <div className="flex gap-2.5">
                {PLANS.map((p, i) => (
                  <button
                    key={p.name}
                    onClick={() => setPlanIdx(i)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      border: "1.5px solid",
                      borderColor: planIdx === i ? "#D4A843" : "rgba(255,255,255,0.14)",
                      background: planIdx === i ? "rgba(184,146,42,0.14)" : "transparent",
                      color: planIdx === i ? "#E8C766" : "rgba(255,255,255,0.55)",
                      cursor: "pointer",
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl p-6 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Monthly</p>
                <p className="font-bold font-mono" style={{ fontSize: 34, color: "#fff" }}>${monthly.toFixed(0)}</p>
              </div>
              <div className="rounded-2xl p-6 text-center" style={{ background: "linear-gradient(135deg, rgba(184,146,42,0.22), rgba(184,146,42,0.08))", border: "1px solid rgba(184,146,42,0.4)" }}>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>Annual</p>
                <p className="font-bold font-mono nx-gold-text" style={{ fontSize: 34 }}>${annual.toFixed(0)}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Application form */}
      <section id="apply" style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 120px" }}>
        <Reveal>
          {status === "success" ? (
            <div className="rounded-3xl p-12 text-center" style={{ background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.3)" }}>
              <div className="mx-auto mb-6 w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(52,211,153,0.14)", border: "1px solid rgba(52,211,153,0.4)" }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M8 14.5l5.5 5.5L20 9.5" stroke="#34D399" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <h2 className="font-display font-bold mb-3" style={{ fontSize: 26, color: "#fff" }}>You&apos;re in.</h2>
              <p className="text-sm mb-7" style={{ color: "rgba(255,255,255,0.6)" }}>Check your email for your referral code and tracking link.</p>
              <div className="inline-block rounded-2xl px-8 py-5" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(52,211,153,0.3)" }}>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Your referral code</p>
                <p className="font-mono font-bold" style={{ fontSize: 28, color: "#E8C766", letterSpacing: "0.12em" }}>{referralCode}</p>
              </div>
            </div>
          ) : (
            <div className="nx-card-dark rounded-3xl p-10">
              <h2 className="font-display font-bold" style={{ fontSize: 26, color: "#fff" }}>Join the program</h2>
              <p className="text-sm mt-1.5 mb-9" style={{ color: "rgba(255,255,255,0.5)" }}>Free to join · commissions paid monthly</p>
              <form onSubmit={handleSubmit}>
                <div className="mb-5">
                  <label style={labelStyle}>Full name</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" style={inputStyle} />
                </div>
                <div className="mb-5">
                  <label style={labelStyle}>Email address</label>
                  <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" style={inputStyle} />
                </div>
                <div className="mb-7">
                  <label style={labelStyle}>How will you promote NexArb?</label>
                  <textarea value={form.promotion_method} onChange={(e) => setForm({ ...form, promotion_method: e.target.value })} placeholder="e.g. YouTube channel, newsletter, seller community…" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                {status === "error" && (
                  <p className="text-sm mb-5" style={{ color: "#F87171" }}>{errorMsg}</p>
                )}
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="nx-btn-gold w-full font-bold py-4 rounded-xl text-base"
                  style={{ color: "#0A0F1E", border: "none", cursor: "pointer", opacity: status === "loading" ? 0.7 : 1 }}
                >
                  {status === "loading" ? "Submitting…" : "Apply to join →"}
                </button>
              </form>
            </div>
          )}
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  );
}
