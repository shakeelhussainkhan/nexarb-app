import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset password — NexArb",
  description: "Reset your NexArb account password",
};

export default function ForgotPasswordPage() {
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
      <SignIn
        routing="hash"
        forceRedirectUrl="/dashboard"
        signUpUrl="/signup"
        initialValues={{ emailAddress: "" }}
      />
    </div>
  );
}
