import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import AuthSplit from "@/components/AuthSplit";

export const metadata: Metadata = {
  title: "Sign in — NexArb",
  description: "Sign in to your NexArb arbitrage dashboard",
};

export default function LoginPage() {
  return (
    <AuthSplit
      title="Welcome back to the hunt."
      subtitle="Your engine is warm — live eligibility, live pricing, and every pending approval waiting for your call."
    >
      <SignIn routing="hash" forceRedirectUrl="/dashboard" signUpUrl="/signup" />
      <a
        href="/forgot-password"
        style={{ color: "#D4A843", fontSize: 14, fontWeight: 500, textDecoration: "none", display: "block", textAlign: "center", marginTop: 20 }}
      >
        Forgot password?
      </a>
    </AuthSplit>
  );
}
