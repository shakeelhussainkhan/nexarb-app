export const dynamic = "force-dynamic";

import { Suspense } from "react";
import DashboardClient from "@/components/DashboardClient";

export const metadata = {
  title: "Dashboard — NexArb",
  description: "Your arbitrage deal pipeline and analytics",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400 text-sm">Loading…</div>}>
      <DashboardClient />
    </Suspense>
  );
}
