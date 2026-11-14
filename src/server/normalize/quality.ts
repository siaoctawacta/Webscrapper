import type { QualityStatus } from "@/lib/domain";
import type { NormalizedBusiness, QualityIssue } from "./types";

const present = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/**
 * Data-quality verdict from the record's own fields.
 *  - issues: missing_name, missing_phone, missing_address, missing_category, invalid_phone,
 *    website_unreachable, email_needs_review (in that order)
 *  - status: `needs_review` when something looks wrong (invalid phone, unreachable website, doubtful
 *    email); otherwise `complete` when name, phone, address and category are all present; otherwise
 *    `incomplete`. A record already flagged as a probable duplicate (duplicateOfId set by the search
 *    runner) stays `duplicate_candidate`.
 */
export function computeQuality(r: Partial<NormalizedBusiness>): { qualityStatus: QualityStatus; qualityIssues: string[] } {
  const issues: QualityIssue[] = [];
  const hasPhone = present(r.phoneRaw) || present(r.phoneE164);
  if (!present(r.name)) issues.push("missing_name");
  if (!hasPhone) issues.push("missing_phone");
  if (!present(r.address)) issues.push("missing_address");
  if (!present(r.category)) issues.push("missing_category");
  if (hasPhone && (r.phoneStatus === "needs_review" || r.phoneStatus === "invalid")) issues.push("invalid_phone");
  if (r.websiteStatus === "unreachable") issues.push("website_unreachable");
  if (present(r.primaryEmail) && (r.emailStatus === "needs_review" || r.emailStatus === "invalid")) issues.push("email_needs_review");

  let qualityStatus: QualityStatus;
  if (r.duplicateOfId) qualityStatus = "duplicate_candidate";
  else if (issues.includes("invalid_phone") || issues.includes("website_unreachable") || issues.includes("email_needs_review")) qualityStatus = "needs_review";
  else if (issues.length === 0) qualityStatus = "complete";
  else qualityStatus = "incomplete";
  return { qualityStatus, qualityIssues: issues };
}
