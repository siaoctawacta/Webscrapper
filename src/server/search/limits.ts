/**
 * Per-user limits for searches and the plain-language messages shown when one is hit.
 * Pure helpers (no DB, no secrets).
 */
import { MAX_TARGET_COUNT } from "@/lib/domain";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return n < 0.01 ? "less than $0.01" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Max results per search: the admin override, else the server default, always within 1..MAX_TARGET_COUNT. */
export function effectiveMaxResults(override: number | null | undefined, envDefault: number): number {
  const v = override ?? envDefault;
  if (!Number.isFinite(v) || v <= 0) return MAX_TARGET_COUNT;
  return Math.max(1, Math.min(MAX_TARGET_COUNT, Math.floor(v)));
}

/** Monthly billable provider requests: the admin override, else the server default. 0 = unlimited. */
export function effectiveMonthlyLimit(override: number | null | undefined, envDefault: number): number {
  const v = override ?? envDefault;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function clampTarget(requested: number, max: number): { targetCount: number; clamped: boolean } {
  const targetCount = Math.max(1, Math.min(requested, max));
  return { targetCount, clamped: targetCount < requested };
}

export const clampMessage = (max: number, requested: number) =>
  `Your account allows up to ${fmt(max)} results per search, so this search will stop at ${fmt(max)} (you asked for ${fmt(requested)}).`;

export const concurrentLimitMessage = (limit: number) =>
  limit === 1
    ? "You already have a search running. Wait for it to finish, or stop it, before starting another."
    : `You already have ${fmt(limit)} searches running. Wait for one to finish, or stop one, before starting another.`;

export const dailyLimitMessage = (limit: number) =>
  `You've reached the limit of ${fmt(limit)} searches in 24 hours. Please try again later.`;

export function monthlyLimitMessage(p: { needed: number; used: number; limit: number }): string {
  const remaining = Math.max(0, p.limit - p.used);
  if (remaining === 0) {
    return `You've used all ${fmt(p.limit)} Google requests included in your monthly allowance. It resets on the 1st of next month, or an administrator can raise your limit.`;
  }
  return `This search needs about ${fmt(p.needed)} Google requests, but only ${fmt(remaining)} of your ${fmt(p.limit)} monthly requests are left. Ask for fewer results, or ask an administrator to raise your limit.`;
}

export const confirmationMessage = (costUsd: number, requests: number) =>
  `This search could cost about ${formatUsd(costUsd)} on your Google Cloud bill (about ${fmt(requests)} requests). Confirm to start it.`;

export const remainingAllowanceNote = (used: number, limit: number) =>
  `${fmt(Math.max(0, limit - used))} of your ${fmt(limit)} monthly Google requests are left.`;
