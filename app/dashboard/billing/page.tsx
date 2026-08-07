"use client";

import dynamic from "next/dynamic";

const BillingContent = dynamic(() => import("./BillingContent"), {
  ssr: false,
  loading: () => (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <div className="h-8 w-32 rounded bg-gray-200 animate-pulse" />
        <div className="h-4 w-48 rounded bg-gray-100 animate-pulse mt-2" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-6 h-40 animate-pulse" />
    </div>
  ),
});

export default function BillingPage() {
  return <BillingContent />;
}
