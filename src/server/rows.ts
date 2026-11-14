import "server-only";
import type { BusinessRow } from "@/lib/api-types";
import { isFieldKey, type FieldKey } from "@/lib/fields";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { Business, Lead, SearchResult } from "./db/schema";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Valid numbers are shown in international format ("+228 92 38 67 38"); others exactly as provided. */
export function displayPhone(raw: string | null, e164: string | null): string | null {
  if (e164) {
    const p = parsePhoneNumberFromString(e164);
    if (p?.isValid()) return p.formatInternational();
  }
  return raw ?? e164;
}

type BusinessLike = SearchResult | Business;

function base(r: BusinessLike): Omit<BusinessRow, "id" | "duplicateOfId" | "restrictedFields" | "liveFields"> {
  return {
    source: r.source,
    sourceRecordId: r.sourceRecordId,
    name: r.name,
    category: r.category,
    categories: r.categories,
    phone: displayPhone(r.phoneRaw, r.phoneE164),
    phoneE164: r.phoneE164,
    phoneStatus: r.phoneStatus,
    website: r.websiteUrl,
    websiteHost: r.websiteHost,
    websiteStatus: r.websiteStatus,
    websiteCheck: r.websiteCheck ?? null,
    email: r.primaryEmail,
    emails: r.emails,
    emailOrigin: r.emailOrigin ?? null,
    emailStatus: r.emailStatus,
    socials: r.socials,
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
    qualityStatus: r.qualityStatus,
    qualityIssues: r.qualityIssues,
    aiCategory: r.aiCategory,
    retrievedAt: r.retrievedAt.toISOString(),
    enrichedAt: iso(r.enrichedAt),
    lastVerifiedAt: iso(r.lastVerifiedAt),
  };
}

export function searchResultToRow(r: SearchResult): BusinessRow {
  return { id: r.id, ...base(r), duplicateOfId: r.duplicateOfId, restrictedFields: [], liveFields: [] };
}

export function leadToRow(lead: Lead, b: Business): BusinessRow {
  return {
    id: lead.id,
    businessId: b.id,
    ...base(b),
    duplicateOfId: null,
    restrictedFields: b.restrictedFields.filter(isFieldKey) as FieldKey[],
    liveFields: [],
    lead: {
      collectionId: lead.collectionId,
      status: lead.status,
      tags: lead.tags,
      notes: lead.notes,
      lastContactedAt: iso(lead.lastContactedAt),
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    },
  };
}

/** Maps a field key to the BusinessRow value (used by exports and the UI). */
export function rowValue(row: BusinessRow, key: FieldKey): unknown {
  switch (key) {
    case "business_name":
      return row.name;
    case "category":
      return row.category;
    case "phone":
      return row.phone;
    case "website":
      return row.website;
    case "website_status":
      return row.websiteStatus;
    case "email":
      return row.email;
    case "email_status":
      return row.emailStatus;
    case "address":
      return row.address;
    case "city":
      return row.city;
    case "region":
      return row.region;
    case "country":
      return row.country;
    case "postal_code":
      return row.postalCode;
    case "rating":
      return row.rating;
    case "review_count":
      return row.reviewCount;
    case "maps_url":
      return row.mapsUrl;
    case "latitude":
      return row.lat;
    case "longitude":
      return row.lng;
    case "socials":
      return row.socials;
    case "business_status":
      return row.businessStatus;
    case "quality_status":
      return row.qualityStatus;
    case "phone_status":
      return row.phoneStatus;
    case "source":
      return row.source;
    case "source_record_id":
      return row.sourceRecordId;
    case "retrieved_at":
      return row.retrievedAt;
    case "last_verified":
      return row.lastVerifiedAt;
    case "lead_status":
      return row.lead?.status ?? null;
    case "tags":
      return row.lead?.tags ?? null;
    case "notes":
      return row.lead?.notes ?? null;
    case "last_contacted":
      return row.lead?.lastContactedAt ?? null;
    case "added_at":
      return row.lead?.createdAt ?? null;
  }
}
