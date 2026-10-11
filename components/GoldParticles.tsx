"use client";

import { useMemo } from "react";

interface GoldParticlesProps {
  count?: number;
  className?: string;
}

/** Deterministic floating gold particle field (no hydration mismatch). */
export default function GoldParticles({ count = 24, className = "" }: GoldParticlesProps) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        // pseudo-random but deterministic
        const seed = (i * 7919 + 13) % 1000;
        const left = (seed * 37) % 100;
        const top = (seed * 53) % 100;
        const size = 3 + ((seed * 7) % 8);
        const delay = (seed % 12) * 0.9;
        const duration = 9 + (seed % 8);
        const opacity = 0.25 + ((seed % 40) / 100);
        return { left, top, size, delay, duration, opacity, key: i };
      }),
    [count]
  );

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.key}
          className="nx-particle"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
