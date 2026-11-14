// CONTRACT STUB — implemented by the "sample+normalize" module agent. Keep these export signatures.
import type { NewSearchResult } from "../db/schema";
import type { ProviderPlace } from "../providers/types";
import type { EnrichmentResult } from "../enrichment";
import type { QualityStatus } from "@/lib/domain";

/** Columns for a search_results row derived from a provider place (no ids/job fields). */
export type NormalizedBusiness = Omit<NewSearchResult, "id" | "jobId" | "userId" | "position" | "createdAt" | "updatedAt">;

/**
 * Conservative normalization: keeps provider values, derives phoneE164/phoneDigits, websiteHost,
 * websiteStatus ("none" when no website, else "unknown" until checked), primaryEmail, and quality.
 * Never invents values.
 */
export function normalizePlace(_place: ProviderPlace, _ctx: { source: NewSearchResult["source"]; retrievedAt?: Date }): NormalizedBusiness {
  throw new Error("Not implemented yet");
}

/** Merge a website-enrichment result into a normalized record (returns the changed columns). */
export function applyEnrichment(_record: NormalizedBusiness, _e: EnrichmentResult, _at?: Date): Partial<NormalizedBusiness> {
  throw new Error("Not implemented yet");
}

/** Recompute quality from the record's fields. */
export function computeQuality(_r: Partial<NormalizedBusiness>): { qualityStatus: QualityStatus; qualityIssues: string[] } {
  throw new Error("Not implemented yet");
}

export type DuplicateCandidate = { id: string; name: string | null; phoneE164: string | null; address: string | null; websiteHost: string | null; lat: number | null; lng: number | null };

/**
 * Probable duplicates among records that already have distinct provider IDs.
 * Returns duplicateId → originalId (the earlier record wins). Uncertain matches only — flagged for review.
 */
export function findProbableDuplicates(_records: DuplicateCandidate[]): Map<string, string> {
  throw new Error("Not implemented yet");
}
