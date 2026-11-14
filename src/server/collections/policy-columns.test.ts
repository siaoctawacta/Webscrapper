import { describe, expect, it } from "vitest";
import type { SearchResult } from "../db/schema";
import { PROVIDER_FIELDS } from "../providers/policy";
import { ALWAYS_KEPT_FIELDS, businessValuesFromResult, PROVIDER_FIELD_CLEARERS } from "./policy-columns";

const result = (o: Partial<SearchResult> = {}): SearchResult => ({
  id: "00000000-0000-4000-8000-000000000001",
  jobId: "00000000-0000-4000-8000-000000000002",
  userId: "u1",
  position: 1,
  source: "google_places",
  sourceRecordId: "ChIJabc",
  name: "Hôtel Sarakawa",
  category: "Hotel",
  categories: ["hotel", "lodging"],
  phoneRaw: "+228 22 27 65 90",
  phoneE164: "+22822276590",
  phoneDigits: "22822276590",
  websiteUrl: "https://sarakawa.example/",
  websiteHost: "sarakawa.example",
  providerEmail: null,
  address: "Boulevard du Mono, Lomé",
  city: "Lomé",
  region: "Maritime",
  country: "Togo",
  postalCode: "BP 1",
  lat: 6.13,
  lng: 1.25,
  rating: 4.1,
  reviewCount: 812,
  mapsUrl: "https://maps.google.com/?cid=1",
  businessStatus: "OPERATIONAL",
  retrievedAt: new Date("2026-11-01T10:00:00Z"),
  websiteStatus: "present",
  websiteCheck: { status: "ok", https: true, checkedAt: "2026-11-01T10:01:00Z" },
  emails: [{ email: "info@sarakawa.example", sourceUrl: "https://sarakawa.example/contact", sameDomain: true }],
  primaryEmail: "info@sarakawa.example",
  emailOrigin: "website_crawl",
  emailStatus: "source_provided",
  phoneStatus: "source_provided",
  socials: { instagram: "https://instagram.com/sarakawa" },
  enrichedAt: new Date("2026-11-01T10:01:00Z"),
  lastVerifiedAt: null,
  qualityStatus: "complete",
  qualityIssues: [],
  aiCategory: "Hotel",
  aiCategoryConfidence: 0.9,
  duplicateOfId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

describe("businessValuesFromResult", () => {
  it("has a column mapping for every provider field", () => {
    for (const key of PROVIDER_FIELDS) {
      if (ALWAYS_KEPT_FIELDS.includes(key)) continue;
      expect(PROVIDER_FIELD_CLEARERS[key], key).toBeTypeOf("function");
    }
  });

  it("Google: keeps only the place ID, maps link and app-owned data", () => {
    const v = businessValuesFromResult(result(), "u1");
    expect(v).toMatchObject({
      userId: "u1",
      source: "google_places",
      sourceRecordId: "ChIJabc",
      mapsUrl: "https://maps.google.com/?cid=1",
      name: null,
      category: null,
      categories: [],
      phoneRaw: null,
      phoneE164: null,
      phoneDigits: null,
      websiteUrl: null,
      websiteHost: null,
      address: null,
      city: null,
      region: null,
      country: null,
      postalCode: null,
      lat: null,
      lng: null,
      rating: null,
      reviewCount: null,
      businessStatus: null,
      coordsExpireAt: null,
      // app-owned
      websiteStatus: "present",
      primaryEmail: "info@sarakawa.example",
      emailOrigin: "website_crawl",
      emailStatus: "source_provided",
      phoneStatus: "source_provided",
      socials: { instagram: "https://instagram.com/sarakawa" },
      qualityStatus: "complete",
      aiCategory: "Hotel",
      aiCategoryConfidence: 0.9,
    });
    expect(v.emails).toHaveLength(1);
    expect(v.websiteCheck).toMatchObject({ status: "ok" });
    expect(v.restrictedFields).toEqual(
      expect.arrayContaining(["business_name", "category", "phone", "website", "address", "city", "rating", "review_count", "latitude", "longitude"]),
    );
    expect(v.restrictedFields).not.toContain("maps_url");
    expect(v.restrictedFields).not.toContain("source_record_id");
  });

  it("sample data keeps everything", () => {
    const r = result({ source: "sample", sourceRecordId: "sample-1" });
    const v = businessValuesFromResult(r, "u1");
    expect(v.restrictedFields).toEqual([]);
    expect(v).toMatchObject({
      name: r.name,
      categories: r.categories,
      phoneRaw: r.phoneRaw,
      phoneE164: r.phoneE164,
      websiteUrl: r.websiteUrl,
      websiteHost: r.websiteHost,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      rating: r.rating,
      reviewCount: r.reviewCount,
      coordsExpireAt: null,
    });
  });
});
