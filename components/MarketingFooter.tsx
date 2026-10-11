import Link from "next/link";
import { NexArbMark } from "./MarketingNav";

const COLS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Engine", href: "/#engine" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Affiliates", href: "/affiliate" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Start free trial", href: "/signup" },
      { label: "Forgot password", href: "/forgot-password" },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer style={{ background: "#070B16", borderTop: "1px solid rgba(184,146,42,0.14)" }}>
      <div className="mx-auto px-6 lg:px-10 py-16" style={{ maxWidth: 1280 }}>
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <NexArbMark />
            <p className="mt-5 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)", maxWidth: 320 }}>
              AI-powered retail arbitrage with guarded, human-approved purchasing.
              Find margin, verify it live, and never buy blind.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "#34D399", boxShadow: "0 0 8px #34D399" }}
              />
              Engine systems operational
            </div>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: "#B8922A" }}>
                {col.title}
              </p>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm transition-colors hover:text-white"
                      style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div
          className="mt-14 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            © 2026 NexArb · Five S LLC. All rights reserved.
          </p>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            Amazon and Walmart trademarks belong to their respective owners.
          </p>
        </div>
      </div>
    </footer>
  );
}
