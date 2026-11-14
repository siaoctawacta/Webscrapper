import "server-only";
import type { FieldKey } from "@/lib/fields";
import type { SearchResult, businesses } from "../db/schema";
import { canPersist, getPolicy, PROVIDER_FIELDS } from "../providers/policy";

/**
 * Source-policy mapping from a transient search result to a persistable `businesses` row
 * (no I/O). Provider fields the policy forbids storing are written as NULL (or an empty array)
 * and listed in `restrictedFields`; app-owned columns (our own website check, emails found on the
 * business's site, quality, AI category) are always copied.
 */

export type NewBusiness = typeof businesses.$inferInsert;

/** Days Google allows caching coordinates (used only if the policy ever permits storing them). */
const COORDS_CACHE_DAYS = 30;

/**
 * How to blank each provider field's columns when it may not be stored.
 * `source_record_id` is never blanked: it is the record key (Google allows keeping place IDs).
 */
export const PROVIDER_FIELD_CLEARERS: Partial<Record<FieldKey, (v: NewBusiness) => void>> = {
  business_name: (v) => {
    v.name = null;
  },
  category: (v) => {
    v.category = null;
    v.categories = [];
  },
  phone: (v) => {
    v.phoneRaw = null;
    v.phoneE164 = null;
    v.phoneDigits = null;
  },
  website: (v) => {
    v.websiteUrl = null;
    v.websiteHost = null;
  },
  address: (v) => {
    v.address = null;
  },
  city: (v) => {
    v.city = null;
  },
  region: (v) => {
    v.region = null;
  },
  country: (v) => {
    v.country = null;
  },
  postal_code: (v) => {
    v.postalCode = null;
  },
  rating: (v) => {
    v.rating = null;
  },
  review_count: (v) => {
    v.reviewCount = null;
  },
  maps_url: (v) => {
    v.mapsUrl = null;
  },
  latitude: (v) => {
    v.lat = null;
  },
  longitude: (v) => {
    v.lng = null;
  },
  business_status: (v) => {
    v.businessStatus = null;
  },
};

/** Provider field keys that are always kept regardless of policy (record identity). */
export const ALWAYS_KEPT_FIELDS: readonly FieldKey[] = ["source_record_id"];

/** Build the `businesses` insert values for a search result, applying the source policy. */
export function businessValuesFromResult(r: SearchResult, userId: string, now: Date = new Date()): NewBusiness {
  const v: NewBusiness = {
    userId,
    source: r.source,
    sourceRecordId: r.sourceRecordId,

    // Provider fields (blanked below when the policy forbids storing them).
    name: r.name,
    category: r.category,
    categories: r.categories,
    phoneRaw: r.phoneRaw,
    phoneE164: r.phoneE164,
    phoneDigits: r.phoneDigits,
    websiteUrl: r.websiteUrl,
    websiteHost: r.websiteHost,
    address: r.address,
    city: r.city,
    region: r.region,
    country: r.country,
    postalCode: r.postalCode,
    lat: r.lat,
    lng: r.lng,
    rating: r.rating,
    reviewCount: r.reviewCount,
    mapsUrl: r.mapsUrl,
    businessStatus: r.businessStatus,
    retrievedAt: r.retrievedAt,

    // App-owned: always stored.
    providerEmail: r.providerEmail,
    websiteStatus: r.websiteStatus,
    websiteCheck: r.websiteCheck,
    emails: r.emails,
    primaryEmail: r.primaryEmail,
    emailOrigin: r.emailOrigin,
    emailStatus: r.emailStatus,
    phoneStatus: r.phoneStatus,
    socials: r.socials,
    enrichedAt: r.enrichedAt,
    lastVerifiedAt: r.lastVerifiedAt,
    qualityStatus: r.qualityStatus,
    qualityIssues: r.qualityIssues,
    aiCategory: r.aiCategory,
    aiCategoryConfidence: r.aiCategoryConfidence,

    restrictedFields: [],
    coordsExpireAt: null,
  };

  const restricted: FieldKey[] = [];
  for (const key of PROVIDER_FIELDS) {
    if (ALWAYS_KEPT_FIELDS.includes(key) || canPersist(r.source, key)) continue;
    restricted.push(key);
    PROVIDER_FIELD_CLEARERS[key]?.(v);
  }
  v.restrictedFields = restricted;

  // Coordinates from a licensed (non-sample) source may only be cached temporarily.
  if (!getPolicy(r.source).isSample && (v.lat != null || v.lng != null)) {
    v.coordsExpireAt = new Date(now.getTime() + COORDS_CACHE_DAYS * 24 * 3600 * 1000);
  }
  return v;
}
