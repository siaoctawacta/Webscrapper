/**
 * Pure mapping from Places API (New) JSON to our provider types. No network, no secrets.
 * Provider content is untrusted: every field is type-checked and anything unexpected becomes null.
 */
import type { LatLng, Rect } from "@/lib/domain";
import type { ProviderPlace } from "../types";

/** Place fields we request — and only these (billing depends on the field mask). */
export const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "location",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "businessStatus",
] as const;

/** Text Search (search + findPlace). */
export const TEXT_SEARCH_FIELD_MASK = `${PLACE_FIELDS.map((f) => `places.${f}`).join(",")},nextPageToken`;
/** findPlace never pages. */
export const FIND_PLACE_FIELD_MASK = PLACE_FIELDS.map((f) => `places.${f}`).join(",");
/** Place Details (GET /places/{id}) uses the same fields without the `places.` prefix. */
export const DETAILS_FIELD_MASK = PLACE_FIELDS.join(",");
/** Location lookup for keyword + location searches. */
export const GEOCODE_FIELD_MASK = "places.displayName,places.location,places.viewport,places.formattedAddress,places.addressComponents";

/* Shapes of the Places API (New) JSON we read (all optional: never trust the provider). */
export type GoogleLatLng = { latitude?: unknown; longitude?: unknown };
export type GoogleAddressComponent = { longText?: unknown; shortText?: unknown; types?: unknown };
export type GooglePlace = {
  id?: unknown;
  displayName?: { text?: unknown; languageCode?: unknown };
  formattedAddress?: unknown;
  addressComponents?: unknown;
  nationalPhoneNumber?: unknown;
  internationalPhoneNumber?: unknown;
  websiteUri?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  googleMapsUri?: unknown;
  location?: GoogleLatLng;
  viewport?: { low?: GoogleLatLng; high?: GoogleLatLng };
  primaryType?: unknown;
  primaryTypeDisplayName?: { text?: unknown };
  types?: unknown;
  businessStatus?: unknown;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed non-empty string (control characters removed), else null. */
export function str(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function httpUrl(v: unknown): string | null {
  const s = str(v, 2048);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}

export function readLatLng(v: unknown): LatLng | null {
  if (!isObject(v)) return null;
  const lat = num(v.latitude);
  const lng = num(v.longitude);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function readViewport(v: unknown): Rect | null {
  if (!isObject(v)) return null;
  const low = readLatLng(v.low);
  const high = readLatLng(v.high);
  if (!low || !high || low.lat > high.lat) return null;
  return { low, high };
}

export type AddressParts = {
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
};

/** addressComponents → city (locality, else postal_town), region, country, ISO code, postal code. */
export function addressParts(components: unknown): AddressParts {
  const list = Array.isArray(components) ? components.filter(isObject) : [];
  const find = (type: string) =>
    list.find((c) => Array.isArray(c.types) && (c.types as unknown[]).includes(type)) as GoogleAddressComponent | undefined;
  const long = (type: string) => str(find(type)?.longText ?? null);
  const country = find("country");
  const code = str(country?.shortText ?? null);
  return {
    city: long("locality") ?? long("postal_town"),
    region: long("administrative_area_level_1"),
    country: str(country?.longText ?? null),
    countryCode: code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null,
    postalCode: long("postal_code"),
  };
}

/** "guest_house" → "Guest house" (only used when Google sends no display name for the type). */
function humanizeType(t: string): string {
  const s = t.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Map one Places API (New) place to a ProviderPlace. Returns null when it has no usable id. */
export function mapPlace(raw: unknown): ProviderPlace | null {
  if (!isObject(raw)) return null;
  const p = raw as GooglePlace;
  const id = str(p.id, 512);
  if (!id) return null;

  const types = Array.isArray(p.types) ? p.types.map((t) => str(t, 100)).filter((t): t is string => t !== null) : [];
  const primaryType = str(p.primaryType, 100);
  const categories = primaryType && !types.includes(primaryType) ? [primaryType, ...types] : types;
  const displayType = isObject(p.primaryTypeDisplayName) ? str(p.primaryTypeDisplayName.text, 200) : null;
  const rating = num(p.rating);
  const reviewCount = num(p.userRatingCount);
  const location = readLatLng(p.location);
  const address = addressParts(p.addressComponents);

  return {
    sourceRecordId: id,
    name: isObject(p.displayName) ? str(p.displayName.text, 500) : null,
    category: displayType ?? (primaryType ? humanizeType(primaryType) : null),
    categories,
    phoneNational: str(p.nationalPhoneNumber, 64),
    phoneInternational: str(p.internationalPhoneNumber, 64),
    websiteUrl: httpUrl(p.websiteUri),
    email: null,
    address: str(p.formattedAddress, 1000),
    city: address.city,
    region: address.region,
    country: address.country,
    countryCode: address.countryCode,
    postalCode: address.postalCode,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount: reviewCount !== null && reviewCount >= 0 ? Math.round(reviewCount) : null,
    mapsUrl: httpUrl(p.googleMapsUri),
    businessStatus: str(p.businessStatus, 64),
  };
}

/** The `places` array of a Text Search response ([] when absent). */
export function readPlaces(data: unknown): unknown[] {
  return isObject(data) && Array.isArray(data.places) ? data.places : [];
}

export function mapPlaces(data: unknown): ProviderPlace[] {
  return readPlaces(data)
    .map(mapPlace)
    .filter((p): p is ProviderPlace => p !== null);
}

export function readNextPageToken(data: unknown): string | null {
  return isObject(data) ? str(data.nextPageToken, 4096) : null;
}
