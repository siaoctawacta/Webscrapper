import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Random URL-safe secret (256 bits). */
export const newSecretToken = () => randomBytes(32).toString("base64url");

/** Tokens are stored only as SHA-256 hashes. */
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Constant-time comparison of two secrets of any length. */
export function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Headers the sign-up form uses to present an invite link token or the first-admin setup token. */
export const INVITE_TOKEN_HEADER = "x-invite-token";
export const SETUP_TOKEN_HEADER = "x-setup-token";
