import type { NewSearchResult } from "../db/schema";

/** Columns for a search_results row derived from a provider place (no ids/job fields). */
export type NormalizedBusiness = Omit<NewSearchResult, "id" | "jobId" | "userId" | "position" | "createdAt" | "updatedAt">;

export type DuplicateCandidate = { id: string; name: string | null; phoneE164: string | null; address: string | null; websiteHost: string | null; lat: number | null; lng: number | null };

/** Issue codes produced by computeQuality (stored in quality_issues). */
export const QUALITY_ISSUES = [
  "missing_name",
  "missing_phone",
  "missing_address",
  "missing_category",
  "invalid_phone",
  "website_unreachable",
  "email_needs_review",
] as const;
export type QualityIssue = (typeof QUALITY_ISSUES)[number];
