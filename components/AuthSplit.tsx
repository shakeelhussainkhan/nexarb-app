"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import GoldParticles from "./GoldParticles";
import { NexArbMark } from "./MarketingNav";

interface AuthSplitProps {
  children: ReactNode;
  title: string;
  subtitle: string;
}

/**
 * Split-screen auth layout: cinematic brand panel on the left,
 * Clerk form on the right. Dark premium theme throughout.
 */
export default function AuthSplit({ children, title, subtitle }: AuthSplitProps) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ background: "#070B16" }}>
      {/* Brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12" style={{ background: "#0A0F1E" }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 30% 30%, rgba(184,146,42,0.16) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 75% 80%, rgba(184,146,42,0.08) 0%, transparent 60%)",
          }}
        />
        <video
          className="absolute inset-0 w-full h-full object-cover opacity-30"
          src="/hero/nexarb-hero.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(7,11,22,0.55) 0%, rgba(7,11,22,0.85) 100%)" }} />
        <GoldParticles count={20} />

        <div className="relative z-10">
          <Link href="/" style={{ textDecoration: "none" }}>
            <NexArbMark />
          </Link>
        </div>

        <div className="relative z-10">
          <h2 className="font-display" style={{ fontSize: "clamp(30px, 3.2vw, 44px)", fontWeight: 700, color: "#fff", lineHeight: 1.15 }}>
            {title}
          </h2>
          <p className="mt-4 text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.6)", maxWidth: 420 }}>
            {subtitle}
          </p>
          <div className="mt-8 space-y-3.5">
            {["Live Amazon SP-API eligibility", "Walmart API connected", "Every purchase human-approved"].map((t) => (
              <div key={t} className="flex items-center gap-3 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(184,146,42,0.12)", border: "1px solid rgba(184,146,42,0.35)" }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.4 2.4 4.6-5.4" stroke="#D4A843" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                {t}
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
          © 2026 NexArb · Five S LLC
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-col items-center justify-center px-6 py-12 overflow-y-auto">
        <div className="w-full lg:hidden mb-10 flex justify-center">
          <Link href="/" style={{ textDecoration: "none" }}>
            <NexArbMark />
          </Link>
        </div>
        <div className="w-full nx-hero-enter" style={{ maxWidth: 420 }}>
          {children}
        </div>
        <style>{`
          .cl-card { background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(184,146,42,0.2) !important; box-shadow: 0 24px 64px rgba(0,0,0,0.5) !important; }
          .cl-headerTitle, .cl-headerSubtitle { color: #fff !important; }
          .cl-headerSubtitle { color: rgba(255,255,255,0.6) !important; }
          .cl-formFieldLabel { color: rgba(255,255,255,0.7) !important; }
          .cl-formFieldInput { background: rgba(255,255,255,0.05) !important; border-color: rgba(255,255,255,0.14) !important; color: #fff !important; }
          .cl-formFieldInput::placeholder { color: rgba(255,255,255,0.3) !important; }
          .cl-formButtonPrimary { background: linear-gradient(135deg,#B8922A,#D4A843) !important; color: #0A0F1E !important; font-weight: 700 !important; }
          .cl-footerActionText, .cl-footerActionLink { color: rgba(255,255,255,0.6) !important; }
          .cl-footerActionLink { color: #D4A843 !important; }
          .cl-identityPreviewText, .cl-identityPreviewEditButton { color: rgba(255,255,255,0.7) !important; }
          .cl-socialButtonsBlockButton { background: rgba(255,255,255,0.05) !important; border-color: rgba(255,255,255,0.14) !important; color: #fff !important; }
          .cl-dividerText, .cl-dividerLine { color: rgba(255,255,255,0.4) !important; }
          .cl-otpCodeFieldInput { background: rgba(255,255,255,0.05) !important; border-color: rgba(255,255,255,0.14) !important; color: #fff !important; }
          .cl-alertText { color: #fff !important; }
        `}</style>
      </div>
    </div>
  );
}
