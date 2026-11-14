/**
 * Test-only builders for the proposals module (imported by *.test.ts files only, never by app code).
 */
import type { BusinessRow, SenderProfile } from "@/lib/api-types";

/** A business with every fact a proposal can use. */
export function fullRow(o: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    source: "google_places",
    sourceRecordId: "ChIJtest",
    name: "Hôtel Le Bénin",
    category: "Hotel",
    categories: ["hotel"],
    phone: "+228 90 12 34 56",
    phoneE164: "+22890123456",
    phoneStatus: "source_provided",
    website: "http://hotel-le-benin.example/",
    websiteHost: "hotel-le-benin.example",
    websiteStatus: "present",
    websiteCheck: { status: "ok", https: false, mobileViewport: false, copyrightYear: 2017, checkedAt: "2026-11-01T00:00:00.000Z" },
    email: "contact@hotel-le-benin.example",
    emails: [{ email: "contact@hotel-le-benin.example", sourceUrl: "http://hotel-le-benin.example/contact", sameDomain: true }],
    emailOrigin: "website_crawl",
    emailStatus: "source_provided",
    socials: { facebook: "https://facebook.com/hotellebenin", instagram: "https://instagram.com/hotellebenin" },
    address: "12 Rue du Commerce",
    city: "Lomé",
    region: "Maritime",
    country: "Togo",
    postalCode: null,
    lat: 6.13,
    lng: 1.22,
    rating: 4.6,
    reviewCount: 87,
    mapsUrl: "https://maps.google.com/?cid=1",
    businessStatus: "OPERATIONAL",
    qualityStatus: "complete",
    qualityIssues: [],
    duplicateOfId: null,
    aiCategory: null,
    retrievedAt: "2026-11-01T00:00:00.000Z",
    enrichedAt: "2026-11-01T00:00:00.000Z",
    lastVerifiedAt: null,
    restrictedFields: [],
    liveFields: [],
    ...o,
  };
}

/** A business we know almost nothing about. */
export function minimalRow(o: Partial<BusinessRow> = {}): BusinessRow {
  return fullRow({
    name: null,
    category: null,
    city: null,
    rating: null,
    reviewCount: null,
    website: null,
    websiteHost: null,
    websiteStatus: "unknown",
    websiteCheck: null,
    email: null,
    emails: [],
    socials: {},
    phone: null,
    phoneE164: null,
    ...o,
  });
}

export const fullSender = (o: Partial<SenderProfile> = {}): SenderProfile => ({
  senderName: "Kofi Mensah",
  senderCompany: "Atelier Web",
  senderEmail: "kofi@atelier.example",
  senderPhone: "+228 90 00 00 00",
  senderWebsite: "https://atelier.example",
  senderPortfolioUrl: null,
  signature: null,
  defaultLanguage: "en",
  ...o,
});

export const emptySender = (): SenderProfile => ({
  senderName: null,
  senderCompany: null,
  senderEmail: null,
  senderPhone: null,
  senderWebsite: null,
  senderPortfolioUrl: null,
  signature: null,
  defaultLanguage: "en",
});
