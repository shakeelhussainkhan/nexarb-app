"use client";

import Link from "next/link";
import { blogPosts } from "@/lib/blog-posts";

export default function BlogIndexPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "Inter, sans-serif" }}>
      {/* Nav */}
      <header style={{ borderBottom: "1px solid #F3F4F6", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <Link href="https://nexarb.io" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" fill="#B8922A" />
              <text x="32" y="40" textAnchor="middle" fill="#0D1B2A" fontSize="24" fontWeight="700" fontFamily="Georgia, serif">N</text>
            </svg>
            <span style={{ fontWeight: 600, color: "#0D1B2A", fontSize: 16, fontFamily: "var(--font-playfair, Georgia, serif)" }}>NexArb</span>
          </Link>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <Link href="/blog" style={{ color: "#B8922A", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>Blog</Link>
            <Link href="/dashboard" style={{ background: "#0D1B2A", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Dashboard</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section style={{ padding: "72px 24px 48px", textAlign: "center" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <p style={{ color: "#B8922A", fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>NexArb Blog</p>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 700, color: "#0D1B2A", fontFamily: "var(--font-playfair, Georgia, serif)", margin: "0 0 16px", lineHeight: 1.2 }}>
            Insights on arbitrage,<br />AI, and sourcing
          </h1>
          <p style={{ color: "#6B7280", fontSize: 17, lineHeight: 1.7, margin: 0 }}>
            Behind-the-scenes stories, strategy guides, and what we&apos;re building at NexArb.
          </p>
        </div>
      </section>

      {/* Posts */}
      <section style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px 96px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {blogPosts.map((post, i) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              style={{ textDecoration: "none" }}
            >
              <article
                className="blog-card"
                style={{
                  background: i === 0 ? "#0D1B2A" : "#F9FAFB",
                  borderRadius: 16,
                  padding: "40px 44px",
                  cursor: "pointer",
                  border: i === 0 ? "none" : "1px solid #F3F4F6",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span style={{
                    background: i === 0 ? "rgba(184,146,42,0.2)" : "#EEE9DE",
                    color: i === 0 ? "#D4A843" : "#B8922A",
                    padding: "4px 12px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                  }}>
                    {post.category}
                  </span>
                  <span style={{ color: i === 0 ? "rgba(255,255,255,0.4)" : "#9CA3AF", fontSize: 13 }}>{post.date}</span>
                  <span style={{ color: i === 0 ? "rgba(255,255,255,0.4)" : "#9CA3AF", fontSize: 13 }}>· {post.readTime}</span>
                </div>
                <h2 style={{
                  fontSize: "clamp(20px, 3vw, 24px)",
                  fontWeight: 700,
                  color: i === 0 ? "#fff" : "#0D1B2A",
                  fontFamily: "var(--font-playfair, Georgia, serif)",
                  margin: "0 0 12px",
                  lineHeight: 1.3,
                }}>
                  {post.title}
                </h2>
                <p style={{ color: i === 0 ? "rgba(255,255,255,0.65)" : "#6B7280", fontSize: 15, lineHeight: 1.7, margin: "0 0 20px" }}>
                  {post.excerpt}
                </p>
                <span style={{ color: "#B8922A", fontWeight: 600, fontSize: 14 }}>Read more →</span>
              </article>
            </Link>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #F3F4F6", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>
          © 2026 NexArb. <Link href="https://nexarb.io" style={{ color: "#B8922A", textDecoration: "none" }}>nexarb.io</Link>
        </p>
      </footer>
    </div>
  );
}
