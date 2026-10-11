"use client";

import Link from "next/link";
import { blogPosts } from "@/lib/blog-posts";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import Reveal from "@/components/Reveal";
import GoldParticles from "@/components/GoldParticles";

export default function BlogIndexPage() {
  return (
    <div style={{ background: "#070B16", color: "#fff", minHeight: "100vh", overflowX: "clip" }}>
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ padding: "160px 24px 70px" }}>
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse 70% 60% at 50% 10%, rgba(184,146,42,0.14) 0%, transparent 65%)" }}
        />
        <GoldParticles count={18} />
        <div className="relative" style={{ maxWidth: 680, margin: "0 auto", textAlign: "center" }}>
          <Reveal>
            <p className="nx-section-label">NexArb Blog</p>
            <h1
              className="font-display mt-5"
              style={{ fontSize: "clamp(36px, 5.5vw, 60px)", fontWeight: 700, lineHeight: 1.1 }}
            >
              Arbitrage, AI, <span className="nx-gold-text">and sourcing.</span>
            </h1>
            <p className="mt-5 text-lg" style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
              Behind-the-scenes stories, strategy guides, and what we&apos;re building at NexArb.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Posts */}
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px 120px" }}>
        <div className="flex flex-col gap-6">
          {blogPosts.map((post, i) => (
            <Reveal key={post.slug} delay={Math.min(i, 2) * 100}>
              <Link href={`/blog/${post.slug}`} style={{ textDecoration: "none", display: "block" }}>
                <article
                  className="nx-card-dark rounded-2xl p-9 md:p-11 cursor-pointer"
                  style={i === 0 ? { border: "1px solid rgba(184,146,42,0.4)", background: "linear-gradient(160deg, rgba(184,146,42,0.1) 0%, rgba(10,15,30,0.5) 70%)" } : {}}
                >
                  <div className="flex items-center gap-3 mb-5 flex-wrap">
                    <span
                      className="text-xs font-semibold tracking-wide px-3.5 py-1.5 rounded-full"
                      style={{ background: "rgba(184,146,42,0.14)", color: "#E8C766", border: "1px solid rgba(184,146,42,0.3)" }}
                    >
                      {post.category}
                    </span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{post.date}</span>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>· {post.readTime}</span>
                    {i === 0 && (
                      <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-full" style={{ background: "linear-gradient(135deg,#B8922A,#D4A843)", color: "#0A0F1E" }}>
                        Featured
                      </span>
                    )}
                  </div>
                  <h2
                    className="font-display font-bold mb-4"
                    style={{ fontSize: "clamp(22px, 3.4vw, 32px)", color: "#fff", lineHeight: 1.25 }}
                  >
                    {post.title}
                  </h2>
                  <p className="text-[15px] leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.62)" }}>
                    {post.excerpt}
                  </p>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "#D4A843" }}>
                    Read article
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 7h10m0 0L8.5 3.5M12 7L8.5 10.5" stroke="#D4A843" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </article>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
