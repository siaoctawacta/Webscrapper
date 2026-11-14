import type { UserStatus } from "@/lib/domain";
import { USER_STATUSES } from "@/lib/domain";

/** Error shape returned by the Better Auth client (`{ data, error }`). */
export type AuthClientError = { code?: string; message?: string; status?: number; statusText?: string } | null | undefined;

export const MIN_PASSWORD_LENGTH = 10;

/** Plain-language message for a failed sign-in. */
export function signInErrorMessage(err: AuthClientError): string {
  if (!err) return "Sign-in failed. Please try again.";
  if (err.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (err.code === "INVALID_EMAIL_OR_PASSWORD" || err.status === 401) {
    return "That email and password don't match. Check them and try again.";
  }
  if (err.code === "INVALID_EMAIL") return "Enter a valid email address.";
  return err.message || "Sign-in failed. Please try again.";
}

/** Plain-language message for a failed sign-up. Server messages (invitation only / closed) are shown as-is. */
export function signUpErrorMessage(err: AuthClientError): string {
  if (!err) return "We couldn't create your account. Please try again.";
  if (err.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (err.code?.startsWith("USER_ALREADY_EXISTS")) return "An account with this email already exists. Sign in instead.";
  if (err.code === "PASSWORD_TOO_SHORT") return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  if (err.code === "PASSWORD_TOO_LONG") return "That password is too long (128 characters at most).";
  if (err.code === "INVALID_EMAIL") return "Enter a valid email address.";
  if (err.status === 403 && err.message) return err.message;
  return err.message || "We couldn't create your account. Please try again.";
}

/** The account status from a Better Auth user object (sent as an additional field). */
export function readUserStatus(u: unknown): UserStatus | null {
  if (!u || typeof u !== "object") return null;
  const s = (u as { status?: unknown }).status;
  return typeof s === "string" && (USER_STATUSES as readonly string[]).includes(s) ? (s as UserStatus) : null;
}
