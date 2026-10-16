export const dynamic = "force-dynamic";

import { Suspense } from "react";
import ExecutiveDashboard from "@/components/ExecutiveDashboard";

export const metadata = {
  title: "Dashboard — NexArb",
  description: "Business overview — money, order pipeline, spend, suppliers, discovery and inventory",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400 text-sm">Loading…</div>}>
      <ExecutiveDashboard />
    </Suspense>
  );
}
