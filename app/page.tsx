import type { Metadata } from "next";
import LandingPage from "@/components/LandingPage";

export const metadata: Metadata = {
  title: "NexArb — AI-Powered Retail Arbitrage",
  description:
    "NexArb finds underpriced products at major retailers, verifies margin live against Amazon and Walmart, and buys only with your approval. Guarded, human-approved arbitrage intelligence.",
  openGraph: {
    title: "NexArb — AI-Powered Retail Arbitrage",
    description:
      "Live SP-API eligibility, live competitive pricing, and guarded purchasing. Never buy blind.",
    type: "website",
  },
};

export default function Home() {
  return <LandingPage />;
}
