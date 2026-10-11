// Cron authentication helper — dependency-free (no next/* imports) so it can
// be unit-tested offline. Vercel injects CRON_SECRET automatically for cron
// jobs; the route compares it against the Authorization: Bearer header with a
// timing-safe comparison. Missing CRON_SECRET -> 503 (never runs open).
import { timingSafeEqual } from "node:crypto";

export type CronAuthStatus = 200 | 401 | 503;

/** 200 ok / 401 bad or missing secret / 503 CRON_SECRET not configured. */
export function cronAuthStatus(
  authHeader: string | null,
  env: NodeJS.ProcessEnv = process.env
): CronAuthStatus {
  const configured = env.CRON_SECRET;
  if (!configured) return 503;
  if (!authHeader?.startsWith("Bearer ")) return 401;
  const provided = authHeader.slice("Bearer ".length);
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return 401;
  return timingSafeEqual(a, b) ? 200 : 401;
}
