/**
 * Normalization of provider places into search_results columns, data-quality scoring, merging of
 * website enrichment and probable-duplicate detection. Pure functions (no I/O, no secrets).
 */
import type { NewSearchResult } from "../db/schema";
import type { ProviderPlace } from "../providers/types";
import type { EnrichmentResult } from "../enrichment";
import type { FoundEmail, QualityStatus } from "@/lib/domain";
import { findProbableDuplicates as findDuplicates } from "./dedupe";
import { applyEnrichment as applyEnrichmentImpl, PROVIDER_EMAIL_SOURCE } from "./enrichment";
import { isLat, isLng } from "./geo";
import { normalizePhone } from "./phone";
import { computeQuality as computeQualityImpl } from "./quality";
import { cleanText } from "./text";
import type { DuplicateCandidate, NormalizedBusiness } from "./types";
import { emailDomain, looksLikeEmail, websiteHostOf } from "./url";

export type { DuplicateCandidate, NormalizedBusiness, QualityIssue } from "./types";
export { QUALITY_ISSUES } from "./types";
export { mergeEmails, sampleEnrichmentToResult, websiteStatusFromCheck, PROVIDER_EMAIL_SOURCE, MAX_STORED_EMAILS } from "./enrichment";
export { DUPLICATE_MAX_DISTANCE_M, DUPLICATE_NAME_SIMILARITY } from "./dedupe";
export { normalizePhone, parseValidPhone, phoneCountry, type NormalizedPhone } from "./phone";
export { emailDomain, isSharedPlatformHost, looksLikeEmail, websiteHostOf } from "./url";
export { foldText, nameKey, nameSimilarity, slugify, stripAccents, titleCase } from "./text";
export { distanceMeters } from "./geo";

const finiteOrNull = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

/**
 * Conservative normalization: keeps provider values, derives phoneE164/phoneDigits, websiteHost,
 * websiteStatus ("none" when no website, else "unknown" until checked), primaryEmail, and quality.
 * Never invents values.
 */
export function normalizePlace(place: ProviderPlace, ctx: { source: NewSearchResult["source"]; retrievedAt?: Date }): NormalizedBusiness {
  const phone = normalizePhone(place.phoneInternational, place.phoneNational, place.countryCode);

  const websiteUrl = cleanText(place.websiteUrl);
  const websiteHost = websiteHostOf(websiteUrl);

  const rawEmail = cleanText(place.email)?.toLowerCase() ?? null;
  const providerEmail = rawEmail && looksLikeEmail(rawEmail) ? rawEmail : null;
  const emails: FoundEmail[] = providerEmail
    ? [{ email: providerEmail, sourceUrl: PROVIDER_EMAIL_SOURCE, sameDomain: websiteHost !== null && emailDomain(providerEmail)?.replace(/^www\./, "") === websiteHost }]
    : [];

  const categories: string[] = [];
  const seen = new Set<string>();
  for (const c of place.categories ?? []) {
    const t = cleanText(c);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      categories.push(t);
    }
  }
  const lat = isLat(place.lat) ? place.lat : null;
  const lng = isLng(place.lng) ? place.lng : null;
  const reviewCount = finiteOrNull(place.reviewCount, 0, Number.MAX_SAFE_INTEGER);

  const record: NormalizedBusiness = {
    source: ctx.source,
    sourceRecordId: place.sourceRecordId,
    name: cleanText(place.name),
    category: cleanText(place.category),
    categories,
    phoneRaw: phone.phoneRaw,
    phoneE164: phone.phoneE164,
    phoneDigits: phone.phoneDigits,
    websiteUrl,
    websiteHost,
    providerEmail,
    address: cleanText(place.address),
    city: cleanText(place.city),
    region: cleanText(place.region),
    country: cleanText(place.country),
    postalCode: cleanText(place.postalCode),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    rating: finiteOrNull(place.rating, 0, 5),
    reviewCount: reviewCount === null ? null : Math.round(reviewCount),
    mapsUrl: cleanText(place.mapsUrl),
    businessStatus: cleanText(place.businessStatus),
    retrievedAt: ctx.retrievedAt ?? new Date(),
    websiteStatus: websiteUrl ? "unknown" : "none",
    websiteCheck: null,
    emails,
    primaryEmail: providerEmail,
    emailOrigin: providerEmail ? "provider" : null,
    emailStatus: providerEmail ? "source_provided" : "unknown",
    phoneStatus: phone.phoneStatus,
    socials: {},
    enrichedAt: null,
    lastVerifiedAt: null,
    qualityStatus: "incomplete",
    qualityIssues: [],
    aiCategory: null,
    aiCategoryConfidence: null,
  };
  const q = computeQualityImpl(record);
  record.qualityStatus = q.qualityStatus;
  record.qualityIssues = q.qualityIssues;
  return record;
}

/** Merge a website-enrichment result into a normalized record (returns the changed columns). */
export function applyEnrichment(record: NormalizedBusiness, e: EnrichmentResult, at?: Date): Partial<NormalizedBusiness> {
  return applyEnrichmentImpl(record, e, at);
}

/** Recompute quality from the record's fields. */
export function computeQuality(r: Partial<NormalizedBusiness>): { qualityStatus: QualityStatus; qualityIssues: string[] } {
  return computeQualityImpl(r);
}

/**
 * Probable duplicates among records that already have distinct provider IDs.
 * Returns duplicateId → originalId (the earlier record wins). Uncertain matches only — flagged for review.
 */
export function findProbableDuplicates(records: DuplicateCandidate[]): Map<string, string> {
  return findDuplicates(records);
}
