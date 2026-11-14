/**
 * Short-lived download tokens (no secrets stored): 32 random bytes, base64url. Only the SHA-256
 * hash is kept in the database, and comparisons are constant-time.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintDownloadToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Constant-time check of a presented token against the stored SHA-256 hex hash. */
export function tokenMatches(token: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!token || !storedHash || !TOKEN_RE.test(token) || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
