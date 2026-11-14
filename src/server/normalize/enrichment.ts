import type { FoundEmail, Socials, VerificationStatus, WebsiteCheck, WebsiteStatus } from "@/lib/domain";
import type { EnrichmentResult } from "../enrichment";
import type { ProviderPlace } from "../providers/types";
import { computeQuality } from "./quality";
import type { NormalizedBusiness } from "./types";
import { emailDomain } from "./url";

/** Marker used in FoundEmail.sourceUrl for an address supplied by the data provider itself. */
export const PROVIDER_EMAIL_SOURCE = "provider";
/** Upper bound on stored addresses per business. */
export const MAX_STORED_EMAILS = 10;

/**
 * Website status after our own visit:
 * ok / blocked_by_robots → present (the site exists; robots only stopped us reading it),
 * unreachable / error → unreachable, skipped → no change (null).
 */
export function websiteStatusFromCheck(status: WebsiteCheck["status"]): Exclude<WebsiteStatus, "none" | "unknown"> | null {
  switch (status) {
    case "ok":
    case "blocked_by_robots":
      return "present";
    case "unreachable":
    case "error":
      return "unreachable";
    case "skipped":
      return null;
  }
}

/** Case-insensitive de-duplication, first occurrence wins; addresses are stored lower-cased. */
export function mergeEmails(...lists: FoundEmail[][]): FoundEmail[] {
  const seen = new Set<string>();
  const out: FoundEmail[] = [];
  for (const list of lists) {
    for (const e of list) {
      const email = e.email.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ ...e, email });
      if (out.length >= MAX_STORED_EMAILS) return out;
    }
  }
  return out;
}

type EnrichmentColumns = Pick<
  NormalizedBusiness,
  "websiteStatus" | "websiteCheck" | "emails" | "primaryEmail" | "emailOrigin" | "emailStatus" | "socials" | "enrichedAt" | "qualityStatus" | "qualityIssues"
>;

/**
 * Merge a website-enrichment result into a normalized record. Returns the enrichment columns to
 * update (websiteStatus is omitted when the visit was skipped, or when the record has no website).
 *
 * Emails: the provider's address stays first, then the addresses found on this visit (best first),
 * then any found on earlier visits; duplicates are removed case-insensitively. The primary email is
 * the provider's address if there is one, else the best address found on the site. Its status is
 * `source_provided` (published, not verified), or `needs_review` when the mail-server check found
 * no MX record for its domain.
 */
export function applyEnrichment(record: NormalizedBusiness, e: EnrichmentResult, at: Date = new Date()): Partial<NormalizedBusiness> {
  const changes: Partial<EnrichmentColumns> = {};

  const nextStatus = websiteStatusFromCheck(e.websiteCheck.status);
  if (nextStatus && record.websiteStatus !== "none" && record.websiteUrl) changes.websiteStatus = nextStatus;
  changes.websiteCheck = e.websiteCheck;

  const existing = record.emails ?? [];
  const providerEntries = existing.filter((x) => x.sourceUrl === PROVIDER_EMAIL_SOURCE);
  const earlierCrawl = existing.filter((x) => x.sourceUrl !== PROVIDER_EMAIL_SOURCE);
  const providerEmail = record.providerEmail?.trim().toLowerCase() || null;
  const crawled: FoundEmail[] = e.emails.map((x) => ({ email: x.email, sourceUrl: x.sourceUrl, sameDomain: x.sameDomain }));
  const emails = mergeEmails(providerEntries, crawled, earlierCrawl);
  changes.emails = emails;

  const primary = providerEmail ?? emails[0]?.email ?? null;
  changes.primaryEmail = primary;
  if (!primary) {
    changes.emailOrigin = null;
    changes.emailStatus = "unknown";
  } else {
    const fromProvider = providerEmail !== null || emails[0]?.sourceUrl === PROVIDER_EMAIL_SOURCE;
    changes.emailOrigin = fromProvider ? "provider" : "website_crawl";
    const domain = emailDomain(primary);
    const noMailServer = domain !== null && e.mx[domain] === false;
    const unchanged = record.primaryEmail?.toLowerCase() === primary;
    const keep: VerificationStatus | undefined =
      unchanged && (record.emailStatus === "verified" || record.emailStatus === "invalid") ? record.emailStatus : undefined;
    changes.emailStatus = noMailServer ? "needs_review" : (keep ?? "source_provided");
  }

  const socials: Socials = { ...(record.socials ?? {}) };
  for (const [k, v] of Object.entries(e.socials) as [keyof Socials, string | undefined][]) {
    if (typeof v === "string" && v.trim()) socials[k] = v.trim();
  }
  changes.socials = socials;
  changes.enrichedAt = at;

  const q = computeQuality({ ...record, ...changes });
  changes.qualityStatus = q.qualityStatus;
  changes.qualityIssues = q.qualityIssues;
  return changes;
}

/**
 * Sample provider only: turn the pre-computed `sampleEnrichment` of a place into an
 * EnrichmentResult so the search runner can call applyEnrichment without touching the network.
 * Returns null for places without sample enrichment (no website, or a real provider).
 */
export function sampleEnrichmentToResult(place: ProviderPlace, at: Date = new Date()): EnrichmentResult | null {
  const s = place.sampleEnrichment;
  if (!s) return null;
  const websiteCheck: WebsiteCheck = s.websiteCheck ?? { status: "skipped", checkedAt: at.toISOString() };
  return {
    websiteStatus: websiteStatusFromCheck(websiteCheck.status) ?? "unknown",
    websiteCheck,
    emails: s.emails.map((x) => ({ ...x })),
    socials: { ...s.socials },
    phones: [],
    mx: {},
  };
}
