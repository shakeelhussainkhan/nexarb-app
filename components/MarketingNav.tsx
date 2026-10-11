"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function NexArbMark({ size = 36 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="nx-mark-gold" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0" stopColor="#E8C766" />
            <stop offset="0.5" stopColor="#B8922A" />
            <stop offset="1" stopColor="#8A6D1F" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="29" stroke="url(#nx-mark-gold)" strokeWidth="3" fill="rgba(184,146,42,0.08)" />
        <path d="M20 44V20l24 24V20" stroke="url(#nx-mark-gold)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span
        style={{
          fontWeight: 700,
          fontSize: size * 0.5,
          letterSpacing: "0.02em",
          color: "#fff",
          fontFamily: "var(--font-playfair, Georgia, serif)",
        }}
      >
        NexArb
      </span>
    </span>
  );
}

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#engine", label: "Engine" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/affiliate", label: "Affiliates" },
];

export default function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{
        background: scrolled ? "rgba(10,15,30,0.82)" : "transparent",
        backdropFilter: scrolled ? "blur(18px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(18px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(184,146,42,0.15)" : "1px solid transparent",
      }}
    >
      <div className="mx-auto flex items-center justify-between px-6 lg:px-10" style={{ maxWidth: 1280, height: 72 }}>
        <Link href="/" aria-label="NexArb home" style={{ textDecoration: "none" }}>
          <NexArbMark />
        </Link>
        <nav className="hidden md:flex items-center gap-8">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-sm font-medium transition-colors"
              style={{ color: "rgba(255,255,255,0.72)", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#E8C766")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.72)")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:inline-block text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none" }}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="nx-btn-gold text-sm font-bold px-5 py-2.5 rounded-lg"
            style={{ color: "#0A0F1E", textDecoration: "none" }}
          >
            Start free trial
          </Link>
        </div>
      </div>
    </header>
  );
}
