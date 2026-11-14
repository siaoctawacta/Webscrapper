/**
 * Plain-language labels for business data values (pure, isomorphic — no React).
 * Used by badges, cells, filter chips and the business sheet so wording stays consistent.
 */
import type { QualityStatus, SourceId, VerificationStatus, WebsiteStatus } from "@/lib/domain";

export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  none: "No website",
  present: "Has website",
  unreachable: "Unreachable",
  unknown: "Unknown",
};

export const WEBSITE_STATUS_HELP: Record<WebsiteStatus, string> = {
  none: "No website is listed for this business — a good prospect for a new site.",
  present: "A website is listed and our visit reached it.",
  unreachable: "A website is listed but our visit could not reach it.",
  unknown: "A website is listed but hasn't been checked yet.",
};

/** Short labels for email/phone verification states. Never implies verification that didn't happen. */
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unknown: "Unverified",
  source_provided: "Source-provided",
  verified: "Verified",
  invalid: "Invalid",
  needs_review: "Needs review",
};

export const EMAIL_STATUS_HELP: Record<VerificationStatus, string> = {
  unknown: "Not checked.",
  source_provided: "Published on the business's own website or supplied by the data provider. Not verified.",
  verified: "Confirmed by a verification process.",
  invalid: "A check showed this address can't be used.",
  needs_review: "A check raised doubt — for example the email domain has no mail server.",
};

export const PHONE_STATUS_HELP: Record<VerificationStatus, string> = {
  unknown: "Not checked.",
  source_provided: "Listed by the data provider and looks like a valid number. Not verified.",
  verified: "Confirmed by a verification process.",
  invalid: "This number can't be used.",
  needs_review: "Listed by the data provider but doesn't look like a valid number.",
};

export const QUALITY_LABELS: Record<QualityStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  needs_review: "Needs review",
  duplicate_candidate: "Possible duplicate",
};

export const QUALITY_HELP: Record<QualityStatus, string> = {
  complete: "Name, phone, address and category are all present.",
  incomplete: "Some basic details are missing.",
  needs_review: "Something looks off — see the data quality notes.",
  duplicate_candidate: "Looks like another result (same phone, website, or a very similar name nearby). Nothing was merged.",
};

export const SOURCE_LABELS: Record<SourceId, string> = {
  google_places: "Google Maps",
  sample: "Sample",
};

/** Default attribution per source when no policy info was supplied by the API. */
export const SOURCE_ATTRIBUTION: Record<SourceId, string> = {
  google_places: "Data from Google Maps",
  sample: "Sample data — generated, not real businesses",
};

const QUALITY_ISSUE_LABELS: Record<string, string> = {
  missing_name: "The business name is missing",
  missing_phone: "No phone number is listed",
  missing_address: "No address is listed",
  missing_category: "No category is listed",
  invalid_phone: "The phone number doesn't look valid",
  website_unreachable: "The website couldn't be reached",
  email_needs_review: "The email's domain may not accept mail",
};

/** Plain words for a quality issue code; unknown codes are humanized rather than hidden. */
export function qualityIssueLabel(code: string): string {
  const known = QUALITY_ISSUE_LABELS[code];
  if (known) return known;
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

const BUSINESS_STATUS_LABELS: Record<string, string> = {
  OPERATIONAL: "Open",
  CLOSED_TEMPORARILY: "Temporarily closed",
  CLOSED_PERMANENTLY: "Permanently closed",
};

export function businessStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return BUSINESS_STATUS_LABELS[status] ?? qualityIssueLabel(status.toLowerCase());
}

export const SOCIAL_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
} as const;
export type SocialKey = keyof typeof SOCIAL_LABELS;
export const SOCIAL_KEYS = Object.keys(SOCIAL_LABELS) as SocialKey[];
