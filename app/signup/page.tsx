import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import AuthSplit from "@/components/AuthSplit";

export const metadata: Metadata = {
  title: "Create account — NexArb",
  description: "Start your 14-day free trial with NexArb arbitrage intelligence",
};

export default function SignUpPage() {
  return (
    <AuthSplit
      title="Start finding margin in minutes."
      subtitle="14-day free trial. No credit card. Verify your first deal live against Amazon before you spend a dollar."
    >
      <SignUp routing="hash" forceRedirectUrl="/onboarding" signInUrl="/login" />
    </AuthSplit>
  );
}
