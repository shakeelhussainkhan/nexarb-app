"use client";

import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";

interface RevealProps {
  children: ReactNode;
  /** stagger delay in ms */
  delay?: number;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "span" | "li";
}

/**
 * Scroll-triggered reveal: fades + rises content into view the first time it
 * enters the viewport. Respects prefers-reduced-motion via CSS.
 */
export default function Reveal({ children, delay = 0, className = "", style, as = "div" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as "div";

  return (
    <Tag
      ref={ref}
      className={`nx-reveal ${className}`}
      style={{ ...style, ["--nx-delay" as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
