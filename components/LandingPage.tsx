"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import MarketingNav from "./MarketingNav";
import MarketingFooter from "./MarketingFooter";
import Reveal from "./Reveal";
import GoldParticles from "./GoldParticles";

/* ---------------- Hero ---------------- */

function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Ensure autoplay kicks in even under strict policies
    videoRef.current?.play().catch(() => {});
  }, []);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden" style={{ background: "#070B16" }}>
      {/* Video background */}
      <div
        className="absolute inset-0"
        style={{ transform: `translateY(${scrollY * 0.28}px)`, willChange: "transform" }}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          src="/hero/nexarb-hero.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        />
      </div>
      {/* Cinematic overlays */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(7,11,22,0.72) 0%, rgba(7,11,22,0.35) 40%, rgba(7,11,22,0.55) 70%, #070B16 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 45%, transparent 30%, rgba(7,11,22,0.65) 100%)",
        }}
      />
      <GoldParticles count={28} />

      {/* Content */}
      <div className="relative z-10 mx-auto px-6 lg:px-10 pt-32 pb-24 w-full" style={{ maxWidth: 1280 }}>
        <div style={{ maxWidth: 860 }}>
          <div className="nx-hero-enter" style={{ animationDelay: "150ms" }}>
            <span
              className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-semibold tracking-widest uppercase"
              style={{
                color: "#E8C766",
                border: "1px solid rgba(184,146,42,0.4)",
                background: "rgba(184,146,42,0.08)",
                backdropFilter: "blur(8px)",
              }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "#34D399", boxShadow: "0 0 10px #34D399", animation: "nx-glow-pulse 2.4s ease-in-out infinite" }}
              />
              AI-Powered Retail Arbitrage
            </span>
          </div>

          <h1
            className="nx-hero-enter mt-7 font-display"
            style={{
              animationDelay: "300ms",
              fontSize: "clamp(44px, 7.5vw, 96px)",
              lineHeight: 1.04,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            Buy low. Sell smart.
            <br />
            <span className="nx-gold-text">Never buy blind.</span>
          </h1>

          <p
            className="nx-hero-enter mt-7 text-lg md:text-xl leading-relaxed"
            style={{ animationDelay: "450ms", color: "rgba(255,255,255,0.72)", maxWidth: 640 }}
          >
            NexArb finds underpriced products at major retailers, verifies margin{" "}
            <strong style={{ color: "#fff", fontWeight: 600 }}>live</strong> against Amazon
            and Walmart, and only ever buys with{" "}
            <strong style={{ color: "#fff", fontWeight: 600 }}>your explicit approval</strong>.
          </p>

          <div
            className="nx-hero-enter mt-10 flex flex-wrap items-center gap-4"
            style={{ animationDelay: "600ms" }}
          >
            <Link
              href="/signup"
              className="nx-btn-gold font-bold px-8 py-4 rounded-xl text-base"
              style={{ color: "#0A0F1E", textDecoration: "none" }}
            >
              Start free trial →
            </Link>
            <Link
              href="/login"
              className="font-semibold px-8 py-4 rounded-xl text-base transition-all hover:bg-white/10"
              style={{
                color: "#fff",
                textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.25)",
                backdropFilter: "blur(8px)",
              }}
            >
              Sign in
            </Link>
          </div>

          <div
            className="nx-hero-enter mt-12 flex flex-wrap gap-x-8 gap-y-3"
            style={{ animationDelay: "750ms" }}
          >
            {["Live Amazon SP-API eligibility", "Walmart API connected", "Human-approved purchasing"].map((t) => (
              <span key={t} className="inline-flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="#B8922A" strokeWidth="1.5" />
                  <path d="M5.5 8.2l1.8 1.8 3.2-3.8" stroke="#B8922A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div
        className="absolute bottom-8 left-1/2 z-10 flex flex-col items-center gap-2"
        style={{ transform: "translateX(-50%)", animation: "nx-float 2.6s ease-in-out infinite" }}
      >
        <span className="text-xs tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>Scroll</span>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 3v14m0 0l-5-5m5 5l5-5" stroke="rgba(184,146,42,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </section>
  );
}

/* ---------------- Capability ticker ---------------- */

function Ticker() {
  const items = [
    "Live SP-API eligibility",
    "Live competitive pricing",
    "Walmart Marketplace API",
    "Guarded purchasing",
    "Fee-stack aware margins",
    "Human approval on every buy",
    "FBA + WFS routing",
    "Real-time P&L",
  ];
  const row = [...items, ...items];
  return (
    <div
      className="relative overflow-hidden py-5"
      style={{ background: "#0A0F1E", borderTop: "1px solid rgba(184,146,42,0.15)", borderBottom: "1px solid rgba(184,146,42,0.15)" }}
    >
      <div className="nx-ticker-track">
        {row.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-3 px-8 text-sm font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.55)" }}>
            <span style={{ color: "#B8922A" }}>◆</span> {t}
          </span>
        ))}
      </div>
      <div className="absolute inset-y-0 left-0 w-32 pointer-events-none" style={{ background: "linear-gradient(90deg, #0A0F1E, transparent)" }} />
      <div className="absolute inset-y-0 right-0 w-32 pointer-events-none" style={{ background: "linear-gradient(-90deg, #0A0F1E, transparent)" }} />
    </div>
  );
}

/* ---------------- Stats band (honest, capability-based) ---------------- */

function StatsBand() {
  const stats = [
    { value: "2", label: "Live marketplace APIs", sub: "Amazon SP-API + Walmart" },
    { value: "100%", label: "Human-approved buys", sub: "Nothing purchased without you" },
    { value: "$500", label: "Default daily spend cap", sub: "Guardrails you control" },
    { value: "20", label: "Max units per ASIN / day", sub: "Velocity-safe sizing" },
  ];
  return (
    <section style={{ background: "#070B16" }}>
      <div className="mx-auto px-6 lg:px-10 py-20" style={{ maxWidth: 1280 }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 100}>
              <div className="text-center px-4 py-8 rounded-2xl nx-card-dark">
                <p className="nx-gold-text font-display" style={{ fontSize: "clamp(36px, 4vw, 52px)", fontWeight: 700, lineHeight: 1 }}>
                  {s.value}
                </p>
                <p className="mt-3 text-sm font-semibold" style={{ color: "#fff" }}>{s.label}</p>
                <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{s.sub}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- How it works ---------------- */

const STEPS = [
  {
    n: "01",
    title: "Submit a candidate",
    desc: "Found something underpriced at Walmart, Target, or any retailer? Drop in the ASIN and the price you see. That's the only manual step.",
    visual: (
      <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(184,146,42,0.2)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>ASIN</span>
          <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: "rgba(184,146,42,0.15)", color: "#E8C766" }}>B004IR3044</span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>Retailer price</span>
          <span className="text-sm font-bold font-mono" style={{ color: "#fff" }}>$5.97</span>
        </div>
        <div className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>walmart.com · in stock</div>
      </div>
    ),
  },
  {
    n: "02",
    title: "NexArb verifies live",
    desc: "The engine pulls the live Amazon competitive price, checks your brand eligibility via SP-API, and scores the deal against fee-stack margins and guardrails.",
    visual: (
      <div className="rounded-xl p-5 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(184,146,42,0.2)" }}>
        {[
          { label: "Live sell price", value: "SP-API ✓", ok: true },
          { label: "Brand eligibility", value: "Checked ✓", ok: true },
          { label: "Margin vs floor", value: "Scored", ok: true },
          { label: "Spend caps", value: "Passed ✓", ok: true },
        ].map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{r.label}</span>
            <span className="font-mono font-semibold" style={{ color: r.ok ? "#34D399" : "#E8C766" }}>{r.value}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    n: "03",
    title: "You approve, it tracks",
    desc: "Winning deals become purchase intents waiting for your tap. Approve, buy, send to prep — NexArb tracks every unit through inventory, P&L, and warehouse.",
    visual: (
      <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(184,146,42,0.2)" }}>
        <div className="flex items-center gap-3 mb-4">
          <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: "rgba(232,199,102,0.15)", color: "#E8C766", border: "1px solid rgba(184,146,42,0.4)" }}>
            PENDING_APPROVAL
          </span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 text-center text-xs font-bold py-2.5 rounded-lg nx-btn-gold" style={{ color: "#0A0F1E" }}>Approve</div>
          <div className="flex-1 text-center text-xs font-semibold py-2.5 rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)" }}>Reject</div>
        </div>
        <div className="mt-3 text-xs font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>10 units · $59.70 · within caps</div>
      </div>
    ),
  },
];

function HowItWorks() {
  return (
    <section id="how" style={{ background: "#070B16" }} className="relative">
      <div className="mx-auto px-6 lg:px-10 py-28" style={{ maxWidth: 1280 }}>
        <Reveal className="text-center" style={{ maxWidth: 720, margin: "0 auto" }}>
          <p className="nx-section-label">How it works</p>
          <h2 className="font-display mt-4" style={{ fontSize: "clamp(32px, 4.5vw, 56px)", fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
            Three steps. <span className="nx-gold-text">Zero blind buys.</span>
          </h2>
          <p className="mt-5 text-lg" style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
            You bring the eye for deals. NexArb brings live verification, honest math, and guardrails that never sleep.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6 mt-16">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 140}>
              <div className="nx-card-dark rounded-2xl p-8 h-full flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <span className="font-display text-5xl font-bold" style={{ color: "rgba(184,146,42,0.35)" }}>{s.n}</span>
                  <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(184,146,42,0.12)", border: "1px solid rgba(184,146,42,0.3)" }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#D4A843", boxShadow: "0 0 12px #D4A843" }} />
                  </span>
                </div>
                <h3 className="text-xl font-bold mb-3" style={{ color: "#fff" }}>{s.title}</h3>
                <p className="text-sm leading-relaxed mb-6 flex-1" style={{ color: "rgba(255,255,255,0.6)" }}>{s.desc}</p>
                {s.visual}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Engine highlights ---------------- */

const ENGINE_FEATURES = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 2l2.4 5.2 5.6.6-4.2 3.9 1.2 5.6-5-2.9-5 2.9 1.2-5.6L6 7.8l5.6-.6L14 2z" stroke="#D4A843" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
    title: "Live SP-API eligibility",
    desc: "Every candidate is checked against Amazon's selling-partner API for your account — brand gating, listing restrictions, approval requirements. Real verdicts, not guesses.",
    badge: "LIVE",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M4 20l5-6 4 3 6-8 5 5" stroke="#D4A843" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 24h20" stroke="#D4A843" strokeWidth="1.8" strokeLinecap="round" opacity="0.4" />
      </svg>
    ),
    title: "Live competitive pricing",
    desc: "The engine reads the real landed Buy Box price straight from Amazon's Product Pricing API, so margin math runs on today's numbers — never stale estimates.",
    badge: "LIVE",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="5" y="10" width="18" height="12" rx="2.5" stroke="#D4A843" strokeWidth="1.8" />
        <path d="M9 10V7.5a5 5 0 0110 0V10" stroke="#D4A843" strokeWidth="1.8" />
        <circle cx="14" cy="16" r="2" fill="#D4A843" />
      </svg>
    ),
    title: "Guarded purchasing",
    desc: "Daily spend caps, per-order limits, per-ASIN velocity caps, and a kill switch. Every intent sits in PENDING_APPROVAL until you say go. Nothing buys itself.",
    badge: "LIVE",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 3v22M14 3l9 4-9 4-9-4 9-4z" stroke="#D4A843" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        <path d="M5 11l9 4 9-4" stroke="#D4A843" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      </svg>
    ),
    title: "Fee-stack aware margins",
    desc: "Referral fees, FBA fulfillment, prep, inbound freight, storage — the pricing engine stacks every cost before it calls anything a deal. Floors are honest.",
    badge: "CORE",
  },
];

function Engine() {
  return (
    <section id="engine" style={{ background: "linear-gradient(180deg, #070B16 0%, #0A0F1E 100%)" }}>
      <div className="mx-auto px-6 lg:px-10 py-28" style={{ maxWidth: 1280 }}>
        <Reveal className="text-center" style={{ maxWidth: 760, margin: "0 auto" }}>
          <p className="nx-section-label">The engine</p>
          <h2 className="font-display mt-4" style={{ fontSize: "clamp(32px, 4.5vw, 56px)", fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
            Built on <span className="nx-gold-text">real APIs</span>, not vibes.
          </h2>
          <p className="mt-5 text-lg" style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
            No paid data subscriptions. No black boxes. NexArb talks directly to Amazon and Walmart —
            and shows its work on every verdict.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 gap-6 mt-16">
          {ENGINE_FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 2) * 120}>
              <div className="nx-card-dark rounded-2xl p-8 h-full">
                <div className="flex items-start justify-between mb-6">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: "rgba(184,146,42,0.1)", border: "1px solid rgba(184,146,42,0.25)", animation: "nx-float 5s ease-in-out infinite", animationDelay: `${i * 0.7}s` }}
                  >
                    {f.icon}
                  </div>
                  <span
                    className="text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full"
                    style={{
                      color: f.badge === "LIVE" ? "#34D399" : "#E8C766",
                      background: f.badge === "LIVE" ? "rgba(52,211,153,0.1)" : "rgba(184,146,42,0.1)",
                      border: `1px solid ${f.badge === "LIVE" ? "rgba(52,211,153,0.3)" : "rgba(184,146,42,0.3)"}`,
                    }}
                  >
                    {f.badge}
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-3" style={{ color: "#fff" }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Dashboard preview (CSS visualization) ---------------- */

function DashboardPreview() {
  const bars = [42, 68, 55, 80, 62, 92, 74, 88, 66, 95, 78, 100];
  return (
    <section style={{ background: "#0A0F1E" }} className="relative overflow-hidden">
      <GoldParticles count={16} />
      <div className="mx-auto px-6 lg:px-10 py-28 relative" style={{ maxWidth: 1280 }}>
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <p className="nx-section-label">Command center</p>
            <h2 className="font-display mt-4" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", fontWeight: 700, color: "#fff", lineHeight: 1.12 }}>
              Every dollar, <span className="nx-gold-text">accounted for.</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
              Approved purchases flow into FIFO inventory tracking, live P&amp;L, and warehouse
              management — so you always know what's on the shelf, what it cost, and what it's worth.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                "FIFO lot tracking from purchase to sale",
                "Dynamic P&L with fee-accurate margins",
                "Warehouse receiving and prep workflow",
                "Telegram alerts on every decision",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.35)" }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.4 2.4 4.6-5.4" stroke="#34D399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="nx-btn-gold inline-block mt-9 font-bold px-7 py-3.5 rounded-xl text-sm" style={{ color: "#0A0F1E", textDecoration: "none" }}>
              See it live →
            </Link>
          </Reveal>

          <Reveal delay={150}>
            <div className="relative">
              <div
                className="absolute -inset-6 rounded-3xl"
                style={{ background: "radial-gradient(ellipse at center, rgba(184,146,42,0.14) 0%, transparent 70%)", filter: "blur(10px)" }}
              />
              <div
                className="relative rounded-2xl overflow-hidden"
                style={{
                  background: "linear-gradient(165deg, #101828 0%, #0A0F1E 100%)",
                  border: "1px solid rgba(184,146,42,0.25)",
                  boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
                  animation: "nx-float-slow 9s ease-in-out infinite",
                }}
              >
                {/* window chrome */}
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <span className="w-3 h-3 rounded-full" style={{ background: "#FF5F57" }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: "#FEBC2E" }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: "#28C840" }} />
                  <span className="ml-3 text-xs font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>app.nexarb.io/dashboard</span>
                </div>
                <div className="p-6">
                  {/* KPI row */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    {[
                      { label: "Margin", value: "31.2%", gold: true },
                      { label: "Units", value: "248", gold: false },
                      { label: "Profit", value: "$4,820", gold: true },
                    ].map((k) => (
                      <div key={k.label} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>{k.label}</p>
                        <p className="text-2xl font-bold font-mono" style={{ color: k.gold ? "#E8C766" : "#fff" }}>{k.value}</p>
                      </div>
                    ))}
                  </div>
                  {/* chart */}
                  <div className="rounded-xl p-5 mb-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <p className="text-[10px] uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>Profit · last 12 weeks</p>
                    <div className="flex items-end gap-2 h-28">
                      {bars.map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-t"
                          style={{
                            height: `${h}%`,
                            background: i === bars.length - 1
                              ? "linear-gradient(180deg, #E8C766, #B8922A)"
                              : "linear-gradient(180deg, rgba(184,146,42,0.7), rgba(184,146,42,0.25))",
                            transformOrigin: "bottom",
                            animation: "nx-bar-grow 1.2s cubic-bezier(0.22,1,0.36,1) both",
                            animationDelay: `${0.4 + i * 0.08}s`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  {/* deal rows */}
                  <div className="space-y-2.5">
                    {[
                      { asin: "B0XXXXXX1X", verdict: "BUY", color: "#34D399" },
                      { asin: "B0XXXXXX2X", verdict: "PENDING", color: "#E8C766" },
                      { asin: "B0XXXXXX3X", verdict: "SKIP", color: "rgba(255,255,255,0.35)" },
                    ].map((d) => (
                      <div key={d.asin} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>{d.asin}</span>
                        <span className="text-[10px] font-bold tracking-widest" style={{ color: d.color }}>{d.verdict}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-center text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Illustrative preview — your live data appears here after sign-in.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Pricing ---------------- */

const PLANS = [
  {
    name: "Solo",
    price: 99,
    desc: "For sellers getting started with guarded arbitrage.",
    features: ["Deal verification engine", "Live SP-API eligibility", "Guarded purchase intents", "Inventory + P&L tracking", "Telegram alerts"],
    cta: "Start free trial",
    featured: false,
  },
  {
    name: "Professional",
    price: 199,
    desc: "For growing sellers running real volume.",
    features: ["Everything in Solo", "Walmart API integration", "Priority verification queue", "Advanced P&L analytics", "Warehouse management"],
    cta: "Start free trial",
    featured: true,
  },
  {
    name: "Agency",
    price: 399,
    desc: "For teams and multi-account operators.",
    features: ["Everything in Professional", "Multiple seller accounts", "Team seats", "API access", "Priority support"],
    cta: "Start free trial",
    featured: false,
  },
];

function Pricing() {
  return (
    <section id="pricing" style={{ background: "#070B16" }}>
      <div className="mx-auto px-6 lg:px-10 py-28" style={{ maxWidth: 1280 }}>
        <Reveal className="text-center" style={{ maxWidth: 680, margin: "0 auto" }}>
          <p className="nx-section-label">Pricing</p>
          <h2 className="font-display mt-4" style={{ fontSize: "clamp(32px, 4.5vw, 56px)", fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
            Pays for itself with <span className="nx-gold-text">one good deal.</span>
          </h2>
          <p className="mt-5 text-lg" style={{ color: "rgba(255,255,255,0.6)" }}>
            14-day free trial on every plan. No credit card required.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6 mt-16 items-stretch" style={{ maxWidth: 1080, margin: "64px auto 0" }}>
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 120} className="h-full">
              <div
                className="rounded-2xl p-8 h-full flex flex-col relative"
                style={{
                  background: p.featured
                    ? "linear-gradient(165deg, rgba(184,146,42,0.14) 0%, rgba(184,146,42,0.04) 100%)"
                    : "rgba(255,255,255,0.02)",
                  border: p.featured ? "1px solid rgba(184,146,42,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  boxShadow: p.featured ? "0 24px 80px rgba(184,146,42,0.18)" : "none",
                  transform: p.featured ? "scale(1.04)" : "none",
                }}
              >
                {p.featured && (
                  <span
                    className="absolute -top-3.5 left-1/2 text-[11px] font-bold tracking-widest uppercase px-4 py-1.5 rounded-full"
                    style={{ transform: "translateX(-50%)", background: "linear-gradient(135deg,#B8922A,#D4A843)", color: "#0A0F1E" }}
                  >
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-bold" style={{ color: "#fff" }}>{p.name}</h3>
                <p className="text-sm mt-1.5 mb-6" style={{ color: "rgba(255,255,255,0.55)" }}>{p.desc}</p>
                <p className="mb-7">
                  <span className="font-display font-bold" style={{ fontSize: 48, color: "#fff" }}>${p.price}</span>
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>/month</span>
                </p>
                <ul className="space-y-3.5 mb-8 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                      <svg className="shrink-0 mt-0.5" width="15" height="15" viewBox="0 0 15 15" fill="none">
                        <circle cx="7.5" cy="7.5" r="6.5" stroke="#B8922A" strokeWidth="1.4" />
                        <path d="M5 7.6l1.8 1.8L10.2 6" stroke="#D4A843" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={p.featured ? "nx-btn-gold text-center font-bold py-3.5 rounded-xl text-sm" : "text-center font-semibold py-3.5 rounded-xl text-sm transition-all hover:bg-white/10"}
                  style={p.featured ? { color: "#0A0F1E", textDecoration: "none" } : { color: "#fff", textDecoration: "none", border: "1px solid rgba(255,255,255,0.2)" }}
                >
                  {p.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */

const FAQS = [
  {
    q: "Do I need Keepa, Tactical Arbitrage, or SellerAmp?",
    a: "No. NexArb is built on official APIs — Amazon SP-API and the Walmart Marketplace API — plus its own first-party verification engine. There are no third-party data subscriptions to buy.",
  },
  {
    q: "Will NexArb buy products automatically?",
    a: "Never. Every winning deal becomes a purchase intent in PENDING_APPROVAL status. Nothing is purchased until you explicitly approve the exact product, quantity, and spend — in the dashboard or via Telegram.",
  },
  {
    q: "How does NexArb know a deal is actually profitable?",
    a: "The pricing engine stacks every cost — referral fees, FBA fulfillment, prep, inbound freight, and storage — then requires your target margin above that floor. Eligibility and pricing are checked live against Amazon at verification time.",
  },
  {
    q: "What marketplaces does NexArb support?",
    a: "Amazon FBA and Walmart WFS today. The engine scores both channels and routes each deal to whichever clears your margin target with the best velocity.",
  },
  {
    q: "What happens after I approve a purchase?",
    a: "The units flow into FIFO inventory tracking, live P&L, and warehouse receiving — so you always know what's on the shelf, what it cost, and what it's worth when it sells.",
  },
];

function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div
      className="rounded-2xl overflow-hidden transition-all"
      style={{ border: "1px solid rgba(184,146,42,0.18)", background: open ? "rgba(184,146,42,0.05)" : "rgba(255,255,255,0.02)" }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 text-left px-7 py-5 cursor-pointer"
        style={{ background: "none", border: "none" }}
        aria-expanded={open}
      >
        <span className="font-semibold" style={{ color: "#fff", fontSize: 16 }}>{q}</span>
        <span
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-300"
          style={{ border: "1px solid rgba(184,146,42,0.4)", transform: open ? "rotate(45deg)" : "none" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="#D4A843" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <div
        className="grid transition-all duration-400"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.4s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="overflow-hidden">
          <p className="px-7 pb-6 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>{a}</p>
        </div>
      </div>
    </div>
  );
}

function Faq() {
  const [openIdx, setOpenIdx] = useState(0);
  return (
    <section id="faq" style={{ background: "linear-gradient(180deg, #070B16 0%, #0A0F1E 100%)" }}>
      <div className="mx-auto px-6 lg:px-10 py-28" style={{ maxWidth: 820 }}>
        <Reveal className="text-center">
          <p className="nx-section-label">FAQ</p>
          <h2 className="font-display mt-4" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", fontWeight: 700, color: "#fff" }}>
            Questions, <span className="nx-gold-text">answered.</span>
          </h2>
        </Reveal>
        <div className="mt-12 space-y-4">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 80}>
              <FaqItem q={f.q} a={f.a} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? -1 : i)} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Final CTA ---------------- */

function FinalCta() {
  return (
    <section className="relative overflow-hidden" style={{ background: "#070B16" }}>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 70% 90% at 50% 110%, rgba(184,146,42,0.22) 0%, transparent 70%)" }}
      />
      <GoldParticles count={20} />
      <div className="relative mx-auto px-6 lg:px-10 py-32 text-center" style={{ maxWidth: 820 }}>
        <Reveal>
          <h2 className="font-display" style={{ fontSize: "clamp(36px, 5.5vw, 68px)", fontWeight: 700, color: "#fff", lineHeight: 1.08 }}>
            Your next profitable product is <span className="nx-gold-text">already on a shelf.</span>
          </h2>
          <p className="mt-6 text-lg" style={{ color: "rgba(255,255,255,0.6)", maxWidth: 560, margin: "24px auto 0", lineHeight: 1.7 }}>
            Start your 14-day free trial. Verify your first deal live within minutes — and never buy blind again.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/signup" className="nx-btn-gold font-bold px-9 py-4 rounded-xl" style={{ color: "#0A0F1E", textDecoration: "none" }}>
              Start free trial →
            </Link>
            <Link
              href="/login"
              className="font-semibold px-9 py-4 rounded-xl transition-all hover:bg-white/10"
              style={{ color: "#fff", textDecoration: "none", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              Sign in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Page ---------------- */

export default function LandingPage() {
  return (
    <div style={{ background: "#070B16", color: "#fff", overflowX: "clip" }}>
      <MarketingNav />
      <main>
        <Hero />
        <Ticker />
        <StatsBand />
        <HowItWorks />
        <Engine />
        <DashboardPreview />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
