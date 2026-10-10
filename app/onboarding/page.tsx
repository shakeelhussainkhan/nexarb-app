"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // Step 1: Amazon
  const [amazonSellerId, setAmazonSellerId] = useState("");
  const [amazonMwsAuthToken, setAmazonMwsAuthToken] = useState("");
  const [amazonMarketplace, setAmazonMarketplace] = useState("ATVPDKIKX0DER");

  // Step 2: Walmart
  const [walmartClientId, setWalmartClientId] = useState("");
  const [walmartClientSecret, setWalmartClientSecret] = useState("");

  // Step 3: Filters
  const [minProfit, setMinProfit] = useState(20);
  const [minRoi, setMinRoi] = useState(30);
  const [maxBsr, setMaxBsr] = useState(50000);

  async function saveStep(stepNum: number, data: Record<string, unknown>) {
    try {
      await fetch("/api/onboarding/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepNum, data }),
      });
    } catch { /* best-effort */ }
  }

  async function handleFinish() {
    setSaving(true);
    await saveStep(3, { min_profit: minProfit, min_roi: minRoi, max_bsr: maxBsr });
    router.push("/dashboard");
  }

  const steps = [
    { n: 1, label: "Amazon" },
    { n: 2, label: "Walmart" },
    { n: 3, label: "Filters" },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: "#F7F8FA" }}>
      <div className="mb-8 flex flex-col items-center">
        <NexArbSeal size={52} />
        <p
          className="mt-3 text-xl font-semibold"
          style={{ fontFamily: "var(--font-playfair), serif", color: "#0D1B2A" }}
        >
          Set up NexArb
        </p>
        <p className="text-sm text-gray-400 mt-1">Connect your accounts to start finding deals</p>
      </div>

      {/* Progress */}
      <div className="w-full max-w-md mb-6">
        <div className="flex items-center justify-between mb-2">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all"
                  style={{
                    background: step >= s.n ? "#0D1B2A" : "#E5E7EB",
                    color: step >= s.n ? "#fff" : "#9CA3AF",
                  }}
                >
                  {step > s.n ? "✓" : s.n}
                </div>
                <span className="text-xs mt-1 text-gray-400">{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 mb-4" style={{ background: step > s.n ? "#0D1B2A" : "#E5E7EB" }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="w-full max-w-md rounded-2xl bg-white border border-gray-100 px-8 py-10"
        style={{ boxShadow: "0 2px 24px 0 rgba(13,27,42,0.07)" }}
      >
        {step === 1 && (
          <StepOne
            sellerId={amazonSellerId}
            setSellerId={setAmazonSellerId}
            mwsToken={amazonMwsAuthToken}
            setMwsToken={setAmazonMwsAuthToken}
            marketplace={amazonMarketplace}
            setMarketplace={setAmazonMarketplace}
            onNext={async () => {
              await saveStep(1, { amz_seller_id: amazonSellerId, amz_mws_token: amazonMwsAuthToken, amz_marketplace: amazonMarketplace });
              setStep(2);
            }}
          />
        )}
        {step === 2 && (
          <StepTwo
            clientId={walmartClientId}
            setClientId={setWalmartClientId}
            clientSecret={walmartClientSecret}
            setClientSecret={setWalmartClientSecret}
            onBack={() => setStep(1)}
            onNext={async () => {
              await saveStep(2, { walmart_client_id: walmartClientId, walmart_secret: walmartClientSecret });
              setStep(3);
            }}
          />
        )}
        {step === 3 && (
          <StepThree
            minProfit={minProfit}
            setMinProfit={setMinProfit}
            minRoi={minRoi}
            setMinRoi={setMinRoi}
            maxBsr={maxBsr}
            setMaxBsr={setMaxBsr}
            saving={saving}
            onBack={() => setStep(2)}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
}

function StepOne({
  sellerId, setSellerId, mwsToken, setMwsToken, marketplace, setMarketplace, onNext,
}: {
  sellerId: string; setSellerId: (v: string) => void;
  mwsToken: string; setMwsToken: (v: string) => void;
  marketplace: string; setMarketplace: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "#FFF3E0" }}>
          🟠
        </div>
        <div>
          <h2 className="font-semibold" style={{ color: "#0D1B2A" }}>Connect Amazon</h2>
          <p className="text-sm text-gray-400">Your Seller ID links your account. SP-API authorization is a separate step — we never ask for your Amazon password.</p>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Seller ID" value={sellerId} onChange={setSellerId} placeholder="A2JJKB8..." />
        <Field label="MWS Auth Token (legacy, optional)" value={mwsToken} onChange={setMwsToken} placeholder="amzn.mws.xxxxxxxx" type="password" />
        <p className="text-xs text-gray-400 -mt-2">MWS is Amazon&apos;s retired API. Leave blank if you don&apos;t have one — eligibility and inventory checks run on SP-API.</p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Marketplace</label>
          <select
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10"
          >
            <option value="ATVPDKIKX0DER">Amazon US</option>
            <option value="A2EUQ1WTGCTBG2">Amazon CA</option>
            <option value="A1F83G8C2ARO7P">Amazon UK</option>
          </select>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onNext}
          className="text-sm text-gray-400 hover:text-gray-600 transition"
        >
          Skip for now →
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
          style={{ background: "#0D1B2A" }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function StepTwo({
  clientId, setClientId, clientSecret, setClientSecret, onBack, onNext,
}: {
  clientId: string; setClientId: (v: string) => void;
  clientSecret: string; setClientSecret: (v: string) => void;
  onBack: () => void; onNext: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "#E3F2FD" }}>
          🔵
        </div>
        <div>
          <h2 className="font-semibold" style={{ color: "#0D1B2A" }}>Connect Walmart API</h2>
          <p className="text-sm text-gray-400">Enable Walmart marketplace scanning</p>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Client ID" value={clientId} onChange={setClientId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        <Field label="Client Secret" value={clientSecret} onChange={setClientSecret} placeholder="••••••••••••••••" type="password" />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 transition">← Back</button>
        <div className="flex gap-3">
          <button type="button" onClick={onNext} className="text-sm text-gray-400 hover:text-gray-600 transition">Skip →</button>
          <button
            type="button"
            onClick={onNext}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: "#0D1B2A" }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function StepThree({
  minProfit, setMinProfit, minRoi, setMinRoi, maxBsr, setMaxBsr, saving, onBack, onFinish,
}: {
  minProfit: number; setMinProfit: (v: number) => void;
  minRoi: number; setMinRoi: (v: number) => void;
  maxBsr: number; setMaxBsr: (v: number) => void;
  saving: boolean; onBack: () => void; onFinish: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "#F0FDF4" }}>
          🎛️
        </div>
        <div>
          <h2 className="font-semibold" style={{ color: "#0D1B2A" }}>Set your filters</h2>
          <p className="text-sm text-gray-400">Customize what deals NexArb finds for you</p>
        </div>
      </div>

      <div className="space-y-6">
        <SliderField
          label="Minimum Profit"
          value={minProfit}
          onChange={setMinProfit}
          min={5}
          max={200}
          display={`$${minProfit}`}
        />
        <SliderField
          label="Minimum ROI"
          value={minRoi}
          onChange={setMinRoi}
          min={10}
          max={200}
          display={`${minRoi}%`}
        />
        <SliderField
          label="Maximum BSR"
          value={maxBsr}
          onChange={setMaxBsr}
          min={1000}
          max={500000}
          step={1000}
          display={maxBsr.toLocaleString()}
        />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 transition">← Back</button>
        <button
          type="button"
          onClick={onFinish}
          disabled={saving}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
          style={{ background: "#B8922A" }}
        >
          {saving ? "Saving…" : "Go to Dashboard →"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#B8922A] focus:ring-2 focus:ring-[#B8922A]/10 placeholder:text-gray-300"
      />
    </div>
  );
}

function SliderField({
  label, value, onChange, min, max, step = 1, display,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; display: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</label>
        <span className="text-sm font-semibold" style={{ color: "#0D1B2A" }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#B8922A]"
      />
      <div className="flex justify-between text-xs text-gray-300 mt-1">
        <span>{min}</span>
        <span>{max.toLocaleString()}</span>
      </div>
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
