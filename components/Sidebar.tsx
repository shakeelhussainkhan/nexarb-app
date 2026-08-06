"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: GridIcon },
  { label: "Deals", href: "/dashboard/deals", icon: TagIcon },
  { label: "Analytics", href: "/dashboard/analytics", icon: ChartIcon },
  { label: "Settings", href: "/dashboard/settings", icon: GearIcon },
  { label: "Billing", href: "/dashboard/billing", icon: CardIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleSignOut() {
    router.push("/login");
  }

  const nav = (
    <nav className="flex-1 px-3 pt-6 space-y-0.5">
      {navItems.map(({ label, href, icon: Icon }) => {
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{
              color: active ? "#B8922A" : "rgba(255,255,255,0.55)",
              background: active ? "rgba(184,146,42,0.12)" : "transparent",
            }}
          >
            <Icon size={17} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const bottom = (
    <div className="px-3 pb-6 space-y-0.5">
      <div className="h-px bg-white/10 mb-3 mx-3" />
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#B8922A", color: "#0D1B2A" }}>
          A
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-white truncate">Alex Johnson</p>
          <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>alex@example.com</p>
        </div>
      </div>
      <button
        onClick={handleSignOut}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium w-full text-left transition-all hover:bg-white/5"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        <LogoutIcon size={17} />
        Sign out
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile topbar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <NexArbSeal size={32} />
          <span className="font-semibold text-sm" style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}>NexArb</span>
        </div>
        <button onClick={() => setOpen(!open)} className="p-2 rounded-lg hover:bg-gray-100 transition">
          {open ? <XIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative flex flex-col w-64 min-h-screen z-50" style={{ background: "#0D1B2A" }}>
            <div className="flex items-center gap-3 px-6 py-7 border-b border-white/10">
              <NexArbSeal size={36} />
              <div>
                <p className="text-base font-semibold leading-none" style={{ fontFamily: "var(--font-playfair), serif", color: "#fff" }}>NexArb</p>
                <p className="text-[10px] tracking-widest uppercase mt-0.5" style={{ color: "#B8922A" }}>Arbitrage</p>
              </div>
            </div>
            {nav}
            {bottom}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 min-h-screen shrink-0" style={{ background: "#0D1B2A" }}>
        <div className="flex items-center gap-3 px-6 py-7 border-b border-white/10">
          <NexArbSeal size={36} />
          <div>
            <p className="text-base font-semibold tracking-tight leading-none" style={{ fontFamily: "var(--font-playfair), serif", color: "#fff" }}>NexArb</p>
            <p className="text-[10px] tracking-widest uppercase mt-0.5" style={{ color: "#B8922A" }}>Arbitrage</p>
          </div>
        </div>
        {nav}
        {bottom}
      </aside>
    </>
  );
}

function NexArbSeal({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="30" fill="#B8922A" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      <text x="32" y="40" textAnchor="middle" fill="#0D1B2A" fontSize="24" fontWeight="700" fontFamily="Georgia, serif">N</text>
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return <circle key={deg} cx={32 + 22 * Math.cos(rad)} cy={32 + 22 * Math.sin(rad)} r="1.8" fill="rgba(13,27,42,0.4)" />;
      })}
    </svg>
  );
}

function GridIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function TagIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function ChartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function CardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function LogoutIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function MenuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function XIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
