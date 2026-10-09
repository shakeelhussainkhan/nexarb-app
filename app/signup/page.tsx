import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account — NexArb",
  description: "Start your 14-day free trial with NexArb arbitrage intelligence",
};

export default function SignUpPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#ffffff",
      }}
    >
      <SignUp
        routing="hash"
        forceRedirectUrl="/onboarding"
        signInUrl="/login"
      />
    </div>
  );
}
