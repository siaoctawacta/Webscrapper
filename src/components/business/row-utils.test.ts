import { describe, expect, it } from "vitest";
import type { BusinessRow } from "@/lib/api-types";
import {
  copyrightAge,
  displayHost,
  isLikelyOutdated,
  isLive,
  isPlausibleEmail,
  isRestricted,
  primaryEmailSource,
  restrictedMessage,
  safeHttpUrl,
  shortUrl,
  telHref,
  whatsappDigits,
} from "./row-utils";
import { qualityIssueLabel } from "./labels";

const row = (over: Partial<BusinessRow> = {}): BusinessRow => ({
  id: "1",
  source: "google_places",
  sourceRecordId: "ChIJ1",
  name: null,
  category: null,
  categories: [],
  phone: null,
  phoneE164: null,
  phoneStatus: "unknown",
  website: null,
  websiteHost: null,
  websiteStatus: "none",
  websiteCheck: null,
  email: null,
  emails: [],
  emailOrigin: null,
  emailStatus: "unknown",
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
  mapsUrl: null,
  businessStatus: null,
  qualityStatus: "incomplete",
  qualityIssues: [],
  duplicateOfId: null,
  aiCategory: null,
  retrievedAt: "2026-11-14T10:00:00.000Z",
  enrichedAt: null,
  lastVerifiedAt: null,
  restrictedFields: [],
  liveFields: [],
  ...over,
});

describe("restricted and live fields", () => {
  it("is restricted only when withheld, not loaded live, and empty", () => {
    expect(isRestricted(row({ restrictedFields: ["phone"] }), "phone")).toBe(true);
    expect(isRestricted(row({ restrictedFields: ["phone"], phone: "+228 22 00 00 00" }), "phone")).toBe(false);
    // loaded live but the business genuinely has no website → missing, not "not stored"
    expect(isRestricted(row({ restrictedFields: ["website"], liveFields: ["website"] }), "website")).toBe(false);
    expect(isRestricted(row(), "phone")).toBe(false);
  });

  it("marks live only when a live value is shown", () => {
    expect(isLive(row({ liveFields: ["phone"], phone: "+228 22 00 00 00" }), "phone")).toBe(true);
    expect(isLive(row({ liveFields: ["website"] }), "website")).toBe(false);
  });

  it("explains the restriction with the policy label", () => {
    expect(restrictedMessage("google_places", [])).toBe("Google Maps terms don't allow storing this field; it's loaded live when available.");
  });
});

describe("links", () => {
  it("only renders http(s) URLs", () => {
    expect(safeHttpUrl("https://hotel.example/")).toBe("https://hotel.example/");
    expect(safeHttpUrl("hotel.example")).toBe("https://hotel.example/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("formats hosts and short page URLs", () => {
    expect(displayHost("https://www.Hotel.example/fr")).toBe("hotel.example");
    expect(displayHost("https://x.example", "www.lodge.example")).toBe("lodge.example");
    expect(shortUrl("https://www.hotel.example/contact/")).toBe("hotel.example/contact");
  });

  it("builds WhatsApp and tel links only from usable numbers", () => {
    expect(whatsappDigits("+22890112233")).toBe("22890112233");
    expect(whatsappDigits("90 11 22 33")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
    expect(telHref({ phone: "+228 90 11 22 33", phoneE164: null })).toBe("tel:+22890112233");
    expect(telHref({ phone: null, phoneE164: null })).toBeNull();
  });

  it("finds where the primary email was published", () => {
    const r = row({ email: "Contact@hotel.example", emails: [{ email: "contact@hotel.example", sourceUrl: "https://hotel.example/contact", sameDomain: true }] });
    expect(primaryEmailSource(r)?.sourceUrl).toBe("https://hotel.example/contact");
    expect(isPlausibleEmail("contact@hotel.example")).toBe(true);
    expect(isPlausibleEmail("not an email")).toBe(false);
  });
});

describe("website freshness and wording", () => {
  it("flags copyright years three or more years old", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(copyrightAge(2017, now)).toBe(9);
    expect(isLikelyOutdated(2023, now)).toBe(true);
    expect(isLikelyOutdated(2024, now)).toBe(false);
    expect(isLikelyOutdated(undefined, now)).toBe(false);
  });

  it("describes quality issues in plain words", () => {
    expect(qualityIssueLabel("missing_phone")).toBe("No phone number is listed");
    expect(qualityIssueLabel("some_new_issue")).toBe("Some new issue");
  });
});
