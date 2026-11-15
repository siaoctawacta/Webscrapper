/**
 * Facts about a business that a proposal may mention. Pure module (no DB, no secrets).
 *
 * Everything here comes from the business row we already hold — nothing is inferred or invented.
 * Missing facts stay null/empty and the templates simply leave the sentence out.
 */
import type { BusinessRow } from "@/lib/api-types";
import type { SourceId, WebsiteStatus } from "@/lib/domain";

export type WebsiteIssue = { kind: "no_https" } | { kind: "not_mobile" } | { kind: "old_copyright"; year: number };

export type ProposalFacts = {
  name: string | null;
  /** Category as used inside a sentence (lower-cased, acronyms kept). */
  category: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: SourceId;
  websiteStatus: WebsiteStatus;
  websiteHost: string | null;
  /** True only when our crawler actually loaded the site (websiteCheck.status = "ok"). */
  websiteChecked: boolean;
  websiteIssues: WebsiteIssue[];
  /** Display names of social networks linked from the business's website / listing. */
  socialNetworks: string[];
};

/** Rating is mentioned only when it is good and backed by enough reviews. */
export const RATING_MIN = 4.0;
export const REVIEWS_MIN = 5;
/** A © year at least this many years old is mentioned as a sign the site is out of date. */
export const COPYRIGHT_STALE_YEARS = 3;

const SOCIAL_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};
const SOCIAL_ORDER = Object.keys(SOCIAL_LABELS);

// Control characters never belong in a message.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;

/** Collapse whitespace, drop control characters, cap length. Empty → null. */
export function cleanText(v: string | null | undefined, max = 120): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "Italian Restaurant" → "italian restaurant"; acronyms ("BTP", "SPA") are kept. */
export function sentenceCategory(category: string | null | undefined): string | null {
  const c = cleanText(category?.replace(/_/g, " "), 80);
  if (!c) return null;
  return c
    .split(" ")
    .map((w) => (/^[A-Z0-9&]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

export function isRatingMentionable(rating: number | null, reviewCount: number | null): rating is number {
  return rating !== null && reviewCount !== null && rating >= RATING_MIN && reviewCount >= REVIEWS_MIN;
}

export function factsFromRow(row: BusinessRow, now: Date = new Date()): ProposalFacts {
  const rating = typeof row.rating === "number" && Number.isFinite(row.rating) && row.rating >= 0 && row.rating <= 5 ? row.rating : null;
  const reviewCount =
    typeof row.reviewCount === "number" && Number.isInteger(row.reviewCount) && row.reviewCount >= 0 ? row.reviewCount : null;

  const check = row.websiteCheck;
  const websiteChecked = row.websiteStatus !== "none" && check?.status === "ok";
  const issues: WebsiteIssue[] = [];
  if (websiteChecked && check) {
    if (check.https === false) issues.push({ kind: "no_https" });
    if (check.mobileViewport === false) issues.push({ kind: "not_mobile" });
    const y = check.copyrightYear;
    if (typeof y === "number" && Number.isInteger(y) && y >= 1990 && y <= now.getUTCFullYear() - COPYRIGHT_STALE_YEARS) {
      issues.push({ kind: "old_copyright", year: y });
    }
  }

  const socials = row.socials ?? {};
  const socialNetworks = SOCIAL_ORDER.filter((k) => {
    const v = socials[k as keyof typeof socials];
    return typeof v === "string" && v.trim() !== "";
  }).map((k) => SOCIAL_LABELS[k]!);

  return {
    name: cleanText(row.name),
    category: sentenceCategory(row.category),
    city: cleanText(row.city, 80),
    rating,
    reviewCount,
    source: row.source,
    websiteStatus: row.websiteStatus,
    websiteHost: row.websiteStatus === "none" ? null : cleanText(row.websiteHost, 120),
    websiteChecked,
    websiteIssues: issues,
    socialNetworks,
  };
}

/** Digits of an E.164 number for wa.me links ("+228 90 12 34 56" → "22890123456"); null when unusable. */
export function whatsappDigits(phoneE164: string | null | undefined): string | null {
  if (!phoneE164 || !/^\+[1-9]\d{6,14}$/.test(phoneE164.replace(/[\s-]/g, ""))) return null;
  return phoneE164.replace(/\D/g, "");
}
