// Personal API keys for first-party integrations (Chrome extension, etc).
// The plaintext key is generated once, shown once, and only its SHA-256
// hash is ever stored. Pure functions — safe to unit-test offline.

import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "nxr_";
const KEY_ENTROPY_BYTES = 32;

export interface GeneratedApiKey {
  /** Plaintext key — return to the caller ONCE, then forget it. */
  plaintext: string;
  /** SHA-256 hex digest — this is what gets stored. */
  hash: string;
}

/** Generate a new personal API key. */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(KEY_ENTROPY_BYTES).toString("base64url");
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

/** SHA-256 hex digest of a presented key. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  if (!plaintext || !storedHash) return false;
  const a = Buffer.from(hashApiKey(plaintext), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Local re-export to avoid importing node:crypto twice in consumers.
import { timingSafeEqual } from "node:crypto";

/** Validate the key's shape before hitting the database. */
export function isPlausibleApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(API_KEY_PREFIX) &&
    value.length >= API_KEY_PREFIX.length + 16
  );
}
