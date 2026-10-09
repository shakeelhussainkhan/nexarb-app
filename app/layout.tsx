import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "NexArb — Arbitrage Intelligence",
    template: "%s",
  },
  description: "AI-powered cross-platform arbitrage deals — find profitable products across Amazon, Walmart, and Alibaba",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${inter.variable} ${playfair.variable} h-full`}>
        <body className="min-h-full bg-white font-sans antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
