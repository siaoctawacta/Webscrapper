import type { BusinessRow } from "@/lib/api-types";
import type { FieldKey } from "@/lib/fields";
import type { NormalizedBusiness } from "../normalize/types";

/**
 * Copies live provider values into the row's restricted fields only (pure, no I/O).
 * Values loaded this way are for display; they are never written back to the database.
 */
const LIVE_FILLERS: Partial<Record<FieldKey, (row: BusinessRow, n: NormalizedBusiness) => void>> = {
  business_name: (row, n) => {
    row.name = n.name ?? null;
  },
  category: (row, n) => {
    row.category = n.category ?? null;
    row.categories = n.categories ?? [];
  },
  phone: (row, n) => {
    row.phone = n.phoneRaw ?? n.phoneE164 ?? null;
    row.phoneE164 = n.phoneE164 ?? null;
  },
  website: (row, n) => {
    row.website = n.websiteUrl ?? null;
    row.websiteHost = n.websiteHost ?? null;
  },
  address: (row, n) => {
    row.address = n.address ?? null;
  },
  city: (row, n) => {
    row.city = n.city ?? null;
  },
  region: (row, n) => {
    row.region = n.region ?? null;
  },
  country: (row, n) => {
    row.country = n.country ?? null;
  },
  postal_code: (row, n) => {
    row.postalCode = n.postalCode ?? null;
  },
  rating: (row, n) => {
    row.rating = n.rating ?? null;
  },
  review_count: (row, n) => {
    row.reviewCount = n.reviewCount ?? null;
  },
  maps_url: (row, n) => {
    row.mapsUrl = n.mapsUrl ?? null;
  },
  latitude: (row, n) => {
    row.lat = n.lat ?? null;
  },
  longitude: (row, n) => {
    row.lng = n.lng ?? null;
  },
  business_status: (row, n) => {
    row.businessStatus = n.businessStatus ?? null;
  },
};

/** Fields hydrateRows can load live. */
export const LIVE_FIELD_KEYS = Object.keys(LIVE_FILLERS) as FieldKey[];

/**
 * Returns a copy of `row` with its restricted fields filled from the live record and those
 * fields listed in `liveFields`. App-owned values (website status, emails, lead data…) are untouched.
 */
export function applyLiveDetails(row: BusinessRow, live: NormalizedBusiness): BusinessRow {
  const out: BusinessRow = { ...row, categories: [...row.categories] };
  const filled: FieldKey[] = [];
  for (const key of row.restrictedFields) {
    const fill = LIVE_FILLERS[key];
    if (!fill) continue;
    fill(out, live);
    filled.push(key);
  }
  out.liveFields = filled;
  return out;
}
