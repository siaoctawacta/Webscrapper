import { describe, expect, it } from "vitest";
import type { BusinessRow } from "@/lib/api-types";
import { normalizePlace } from "../normalize";
import { applyLiveDetails } from "./live-fields";
import { livePlace } from "./test-fixtures";

const row = (o: Partial<BusinessRow> = {}): BusinessRow => ({
  id: "lead-1",
  businessId: "biz-1",
  source: "google_places",
  sourceRecordId: "ChIJx",
  name: null,
  category: null,
  categories: [],
  phone: null,
  phoneE164: null,
  phoneStatus: "source_provided",
  website: null,
  websiteHost: null,
  websiteStatus: "present",
  websiteCheck: null,
  email: "info@x.example",
  emails: [],
  emailOrigin: "website_crawl",
  emailStatus: "source_provided",
  socials: {},
  address: null,
  city: null,
  region: null,
  country: null,
  postalCode: null,
  lat: null,
  lng: null,
  rating: null,
  reviewCount: null,
  mapsUrl: "https://maps.google.com/?cid=1",
  businessStatus: null,
  qualityStatus: "complete",
  qualityIssues: [],
  duplicateOfId: null,
  aiCategory: null,
  retrievedAt: "2026-11-01T00:00:00.000Z",
  enrichedAt: null,
  lastVerifiedAt: null,
  restrictedFields: ["business_name", "phone", "website", "rating"],
  liveFields: [],
  ...o,
});

describe("applyLiveDetails", () => {
  it("fills only restricted fields and lists them as live", () => {
    const live = normalizePlace(livePlace("ChIJx", { mapsUrl: "https://other.example/maps" }), { source: "google_places" });
    const before = row();
    const out = applyLiveDetails(before, live);
    expect(out).toMatchObject({
      name: "Live ChIJx",
      phone: "+228 90 12 34 56",
      phoneE164: "+22890123456",
      website: "https://www.chijx.example/",
      websiteHost: "chijx.example",
      rating: 4.6,
      // not restricted → untouched
      address: null,
      mapsUrl: "https://maps.google.com/?cid=1",
      email: "info@x.example",
      websiteStatus: "present",
    });
    expect(out.liveFields).toEqual(["business_name", "phone", "website", "rating"]);
    expect(before.name).toBeNull(); // input not mutated
  });
});
