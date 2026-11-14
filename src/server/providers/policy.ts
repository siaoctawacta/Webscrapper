import "server-only";
import type { SourcePolicyInfo } from "@/lib/api-types";
import type { SourceId } from "@/lib/domain";
import { FIELDS, FIELD_KEYS, type FieldKey } from "@/lib/fields";
import { env } from "../env";

/**
 * Source policy: what may be stored, for how long, and what may be exported, per data source.
 *
 * This is enforced in the backend at three points:
 *   1. search results are purged after `transientRetentionHours` (worker maintenance job);
 *   2. saving to a collection keeps only `persistableProviderFields` (others are stored as NULL and
 *      listed in businesses.restricted_fields);
 *   3. exports drop provider fields not in `exportableProviderFields` and report why.
 *
 * App-owned fields (origin "enrichment", "derived", "user" in src/lib/fields.ts) are always storable
 * and exportable: they come from our own website visit, our own computation, or the user.
 *
 * GOOGLE DEFAULTS FOLLOW THE "STAY WITHIN GOOGLE'S TERMS" CHOICE: Google Maps Platform terms allow
 * caching place IDs indefinitely (and coordinates for 30 days) but not names, phone numbers, ratings
 * etc., and do not allow bulk export of Places content. If you hold a different agreement with
 * Google, or switch to a licensed provider, change the policy here — deliberately, in code review.
 */
export interface SourcePolicy {
  source: SourceId;
  label: string;
  attribution: string | null;
  isSample: boolean;
  transientRetentionHours: number;
  persistableProviderFields: readonly FieldKey[];
  exportableProviderFields: readonly FieldKey[];
  /** Whether restricted fields can be re-loaded live for display (billed per request). */
  supportsLiveDetails: boolean;
  restrictionReason: string;
}

export const PROVIDER_FIELDS: readonly FieldKey[] = FIELD_KEYS.filter((k) => FIELDS[k].origin === "provider");

const ALL_PROVIDER = PROVIDER_FIELDS;

export function getPolicy(source: SourceId): SourcePolicy {
  switch (source) {
    case "google_places":
      return {
        source,
        label: "Google Maps",
        attribution: "Data from Google Maps",
        isSample: false,
        transientRetentionHours: env().GOOGLE_RESULTS_RETENTION_HOURS,
        persistableProviderFields: ["source_record_id", "maps_url"],
        exportableProviderFields: ["source_record_id", "maps_url"],
        supportsLiveDetails: true,
        restrictionReason: "Google Maps Platform terms do not allow storing or exporting this field",
      };
    case "sample":
      return {
        source,
        label: "Sample data",
        attribution: "Sample data — generated, not real businesses",
        isSample: true,
        transientRetentionHours: 24 * 30,
        persistableProviderFields: ALL_PROVIDER,
        exportableProviderFields: ALL_PROVIDER,
        supportsLiveDetails: false,
        restrictionReason: "",
      };
  }
}

export const isAppOwnedField = (k: FieldKey) => FIELDS[k].origin !== "provider";

export function canPersist(source: SourceId, field: FieldKey): boolean {
  return isAppOwnedField(field) || getPolicy(source).persistableProviderFields.includes(field);
}

export function canExport(source: SourceId, field: FieldKey): boolean {
  return isAppOwnedField(field) || getPolicy(source).exportableProviderFields.includes(field);
}

export function nonPersistableFields(source: SourceId): FieldKey[] {
  return PROVIDER_FIELDS.filter((k) => !canPersist(source, k));
}

export function nonExportableFields(source: SourceId): FieldKey[] {
  return PROVIDER_FIELDS.filter((k) => !canExport(source, k));
}

export function policyInfo(source: SourceId): SourcePolicyInfo {
  const p = getPolicy(source);
  return {
    source,
    label: p.label,
    attribution: p.attribution,
    isSample: p.isSample,
    nonExportableFields: nonExportableFields(source),
    nonPersistableFields: nonPersistableFields(source),
    resultsRetentionHours: p.transientRetentionHours,
  };
}
