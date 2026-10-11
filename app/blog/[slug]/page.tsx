import Link from "next/link";
import { notFound } from "next/navigation";
import { blogPosts, getBlogPost } from "@/lib/blog-posts";
import type { Metadata } from "next";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — NexArb Blog`,
    description: post.excerpt,
  };
}

function renderContent(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={key++} className="font-display" style={{ fontSize: "clamp(22px,3vw,28px)", fontWeight: 700, color: "#fff", marginTop: 48, marginBottom: 18, lineHeight: 1.3 }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(
        <p key={key++} style={{ fontWeight: 700, color: "#E8C766", fontSize: 16, margin: "24px 0 10px" }}>
          {line.slice(2, -2)}
        </p>
      );
    } else if (line.startsWith("- ")) {
      elements.push(
        <li key={key++} style={{ color: "rgba(255,255,255,0.72)", fontSize: 16, lineHeight: 1.8, marginBottom: 6 }}>
          {line.slice(2)}
        </li>
      );
    } else if (line.startsWith("```")) {
      // skip code fence markers
    } else if (line.trim() === "") {
      elements.push(<br key={key++} />);
    } else {
      // Handle inline bold
      const parts = line.split(/\*\*(.*?)\*\*/g);
      if (parts.length > 1) {
        elements.push(
          <p key={key++} style={{ color: "rgba(255,255,255,0.75)", fontSize: 16.5, lineHeight: 1.85, margin: "0 0 18px" }}>
            {parts.map((part, i) =>
              i % 2 === 1 ? <strong key={i} style={{ color: "#fff" }}>{part}</strong> : part
            )}
          </p>
        );
      } else {
        elements.push(
          <p key={key++} style={{ color: "rgba(255,255,255,0.75)", fontSize: 16.5, lineHeight: 1.85, margin: "0 0 18px" }}>
            {line}
          </p>
        );
      }
    }
  }
  return elements;
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const related = blogPosts.filter((p) => p.slug !== slug).slice(0, 2);
  const shareUrl = `https://app.nexarb.io/blog/${slug}`;

  return (
    <div style={{ minHeight: "100vh", background: "#070B16", color: "#fff", overflowX: "clip" }}>
      <MarketingNav />

      {/* Article */}
      <article style={{ maxWidth: 760, margin: "0 auto", padding: "150px 24px 90px" }}>
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm font-medium mb-10 transition-colors"
          style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 7H2m0 0l3.5-3.5M2 7l3.5 3.5" stroke="#D4A843" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to blog
        </Link>

        {/* Meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26, flexWrap: "wrap" }}>
          <span
            className="text-xs font-semibold tracking-wide px-3.5 py-1.5 rounded-full"
            style={{ background: "rgba(184,146,42,0.14)", color: "#E8C766", border: "1px solid rgba(184,146,42,0.3)" }}
          >
            {post.category}
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{post.date}</span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>· {post.readTime}</span>
        </div>

        <h1 className="font-display" style={{ fontSize: "clamp(30px,5vw,46px)", fontWeight: 700, color: "#fff", lineHeight: 1.18, margin: "0 0 28px", letterSpacing: "-0.01em" }}>
          {post.title}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 52, paddingBottom: 32, borderBottom: "1px solid rgba(184,146,42,0.15)" }}>
          <div
            className="font-display"
            style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#B8922A,#D4A843)", display: "flex", alignItems: "center", justifyContent: "center", color: "#0A0F1E", fontWeight: 700, fontSize: 18 }}
          >
            S
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "#fff" }}>Shakeel Hussain Khan</p>
            <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Founder, NexArb</p>
          </div>
        </div>

        {/* Content */}
        <div>
          <ul style={{ paddingLeft: 22, margin: "0 0 16px", listStyle: "none" }}>
            {renderContent(post.content)}
          </ul>
        </div>

        {/* Share */}
        <div style={{ marginTop: 60, paddingTop: 36, borderTop: "1px solid rgba(184,146,42,0.15)" }}>
          <p style={{ fontWeight: 600, color: "#fff", marginBottom: 18, fontSize: 15 }}>Share this article</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff", padding: "11px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              𝕏 Share on X
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(10,102,194,0.16)", border: "1px solid rgba(10,102,194,0.5)", color: "#fff", padding: "11px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              in Share on LinkedIn
            </a>
          </div>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div style={{ marginTop: 64 }}>
            <h3 className="font-display" style={{ fontWeight: 700, color: "#fff", fontSize: 22, marginBottom: 24 }}>Related posts</h3>
            <div className="grid sm:grid-cols-2 gap-5">
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`} style={{ textDecoration: "none" }}>
                  <div className="nx-card-dark rounded-2xl p-7 h-full">
                    <span className="text-xs font-semibold" style={{ color: "#D4A843" }}>{r.category}</span>
                    <h4 style={{ margin: "10px 0", fontSize: 16, fontWeight: 700, color: "#fff", lineHeight: 1.45 }}>{r.title}</h4>
                    <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, margin: 0, lineHeight: 1.65 }}>{r.excerpt.slice(0, 100)}…</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>

      <MarketingFooter />
    </div>
  );
}
