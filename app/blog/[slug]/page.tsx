import Link from "next/link";
import { notFound } from "next/navigation";
import { blogPosts, getBlogPost } from "@/lib/blog-posts";
import type { Metadata } from "next";

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
        <h2 key={key++} style={{ fontSize: "clamp(20px,3vw,24px)", fontWeight: 700, color: "#0D1B2A", fontFamily: "var(--font-playfair,Georgia,serif)", marginTop: 40, marginBottom: 16 }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(
        <p key={key++} style={{ fontWeight: 700, color: "#0D1B2A", fontSize: 16, margin: "20px 0 8px" }}>
          {line.slice(2, -2)}
        </p>
      );
    } else if (line.startsWith("- ")) {
      elements.push(
        <li key={key++} style={{ color: "#374151", fontSize: 16, lineHeight: 1.75, marginBottom: 4 }}>
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
          <p key={key++} style={{ color: "#374151", fontSize: 16, lineHeight: 1.8, margin: "0 0 16px" }}>
            {parts.map((part, i) =>
              i % 2 === 1 ? <strong key={i}>{part}</strong> : part
            )}
          </p>
        );
      } else {
        elements.push(
          <p key={key++} style={{ color: "#374151", fontSize: 16, lineHeight: 1.8, margin: "0 0 16px" }}>
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
          <Link href="/blog" style={{ color: "#6B7280", fontSize: 14, textDecoration: "none" }}>← Back to blog</Link>
        </div>
      </header>

      {/* Article */}
      <article style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px 96px" }}>
        {/* Meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <span style={{ background: "#EEE9DE", color: "#B8922A", padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>
            {post.category}
          </span>
          <span style={{ color: "#9CA3AF", fontSize: 13 }}>{post.date}</span>
          <span style={{ color: "#9CA3AF", fontSize: 13 }}>· {post.readTime}</span>
        </div>

        <h1 style={{ fontSize: "clamp(28px,5vw,40px)", fontWeight: 700, color: "#0D1B2A", fontFamily: "var(--font-playfair,Georgia,serif)", lineHeight: 1.2, margin: "0 0 24px" }}>
          {post.title}
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48, paddingBottom: 32, borderBottom: "1px solid #F3F4F6" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#0D1B2A", display: "flex", alignItems: "center", justifyContent: "center", color: "#B8922A", fontWeight: 700, fontSize: 14 }}>S</div>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "#0D1B2A" }}>Shakeel Hussain Khan</p>
            <p style={{ margin: 0, fontSize: 12, color: "#9CA3AF" }}>Founder, NexArb</p>
          </div>
        </div>

        {/* Content */}
        <div style={{ fontSize: 16, lineHeight: 1.8 }}>
          <ul style={{ paddingLeft: 24, margin: "0 0 16px" }}>
            {renderContent(post.content)}
          </ul>
        </div>

        {/* Share */}
        <div style={{ marginTop: 56, paddingTop: 32, borderTop: "1px solid #F3F4F6" }}>
          <p style={{ fontWeight: 600, color: "#0D1B2A", marginBottom: 16, fontSize: 15 }}>Share this article</p>
          <div style={{ display: "flex", gap: 12 }}>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, background: "#000", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              𝕏 Share on X
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, background: "#0A66C2", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              in Share on LinkedIn
            </a>
          </div>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div style={{ marginTop: 56 }}>
            <h3 style={{ fontWeight: 700, color: "#0D1B2A", fontSize: 20, fontFamily: "var(--font-playfair,Georgia,serif)", marginBottom: 24 }}>Related posts</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 16 }}>
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "#F9FAFB", borderRadius: 12, padding: 24, border: "1px solid #F3F4F6" }}>
                    <span style={{ color: "#B8922A", fontSize: 12, fontWeight: 600 }}>{r.category}</span>
                    <h4 style={{ margin: "8px 0 8px", fontSize: 15, fontWeight: 700, color: "#0D1B2A", lineHeight: 1.4 }}>{r.title}</h4>
                    <p style={{ color: "#6B7280", fontSize: 13, margin: 0, lineHeight: 1.6 }}>{r.excerpt.slice(0, 90)}…</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>

      <footer style={{ borderTop: "1px solid #F3F4F6", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>
          © 2026 NexArb. <Link href="https://nexarb.io" style={{ color: "#B8922A", textDecoration: "none" }}>nexarb.io</Link>
        </p>
      </footer>
    </div>
  );
}
