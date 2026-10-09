import crypto from "crypto";

// AES-256-CBC encryption for stored marketplace secrets (Amazon MWS token,
// Walmart secret). Fails closed: encryptSecret throws when ENCRYPTION_KEY is
// missing rather than ever returning plaintext.
//
// ENCRYPTION_KEY format: preferably 32 bytes encoded as 64-character hex,
// or base64 that decodes to exactly 32 bytes. Any other non-empty value is
// accepted via SHA-256 derivation (legacy compatibility); only a missing
// key fails.

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) {
    return decoded;
  }
  // Legacy passphrase-style keys: derive a deterministic 32-byte key so an
  // existing non-hex env value keeps working instead of failing saves.
  // (Values encrypted under the old zero-padding scheme are not readable by
  // this helper; re-entering the marketplace credentials re-encrypts them.)
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}
