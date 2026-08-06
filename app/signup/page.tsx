"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    await new Promise((r) => setTimeout(r, 800));
    router.push("/onboarding");
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="mb-10 flex flex-col items-center">
        <NexArbSeal size={64} />
        <h1
          className="mt-4 text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}
        >
          NexArb
        </h1>
        <p className="mt-1 text-xs text-gray-400 tracking-widest uppercase">
          Arbitrage Intelligence
        </p>
      </div>

      <div
        className="w-full max-w-sm rounded-2xl bg-white border border-gray-100 px-8 py-10"
        style={{ boxShadow: "0 2px 24px 0 rgba(13,27,42,0.07)" }}
      >
        <h2
          className="text-xl font-semibold mb-1"
          style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}
        >
          Welcome to NexArb
        </h2>
        <p className="text-sm text-gray-400 mb-2">
          Start your 14-day free trial
        </p>

        <div className="flex items-center gap-1.5 mb-6">
          <span className="text-xs text-green-600 bg-green-50 rounded-full px-2.5 py-1 font-medium">
            ✓ No credit card required
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">
              Full Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Johnson"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #0D1B2A 0%, #1a2f45 100%)" }}
          >
            {loading ? "Creating account…" : "Start free trial →"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-300">or</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <button
          type="button"
          onClick={() => router.push("/onboarding")}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mt-6 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            Already have an account?{" "}
            <Link href="/login" className="font-medium" style={{ color: "#B8922A" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <p className="mt-8 text-xs text-gray-300">
        &copy; {new Date().getFullYear()} NexArb. All rights reserved.
      </p>
    </div>
  );
}

function NexArbSeal({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="30" fill="#0D1B2A" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="#B8922A" strokeWidth="1.5" />
      <text x="32" y="40" textAnchor="middle" fill="#B8922A" fontSize="24" fontWeight="700" fontFamily="Georgia, serif">N</text>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return <circle key={deg} cx={32 + 22 * Math.cos(rad)} cy={32 + 22 * Math.sin(rad)} r="1.5" fill="#B8922A" />;
      })}
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
