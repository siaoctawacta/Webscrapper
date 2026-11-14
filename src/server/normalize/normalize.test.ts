import { describe, expect, it } from "vitest";
import type { ProviderPlace } from "../providers/types";
import { computeQuality, normalizePlace, websiteHostOf } from "./index";
import { normalizePhone } from "./phone";
import { boundedLevenshtein, foldText, nameKey, nameSimilarity, slugify, stripAccents, titleCase } from "./text";
import { emailDomain, isSharedPlatformHost, looksLikeEmail } from "./url";

const RETRIEVED = new Date("2026-01-02T03:04:05.000Z");

function place(overrides: Partial<ProviderPlace> = {}): ProviderPlace {
  return {
    sourceRecordId: "rec-1",
    name: "Hôtel Le Palmier d'Or",
    category: "Hotel",
    categories: ["Hotel", "Lodging"],
    phoneNational: "90 12 34 56",
    phoneInternational: "+228 90 12 34 56",
    websiteUrl: "https://www.palmier-dor.example/",
    email: null,
    address: "Rue des Cocotiers, Tokoin, Lomé",
    city: "Lomé",
    region: "Maritime",
    country: "Togo",
    countryCode: "TG",
    postalCode: null,
    lat: 6.1319,
    lng: 1.2228,
    rating: 4.3,
    reviewCount: 120,
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=6.131900,1.222800",
    businessStatus: "OPERATIONAL",
    ...overrides,
  };
}

describe("normalizePhone", () => {
  it("parses a Togo international number to E.164", () => {
    expect(normalizePhone("+228 90 12 34 56", "90 12 34 56", "TG")).toEqual({
      phoneRaw: "+228 90 12 34 56",
      phoneE164: "+22890123456",
      phoneDigits: "22890123456",
      phoneStatus: "source_provided",
    });
  });

  it("parses a Togo national number with the country code", () => {
    const p = normalizePhone(null, "22 21 34 56", "TG");
    expect(p.phoneRaw).toBe("22 21 34 56");
    expect(p.phoneE164).toBe("+22822213456");
    expect(p.phoneStatus).toBe("source_provided");
  });

  it("parses Ghana mobile and landline numbers", () => {
    expect(normalizePhone(null, "024 123 4567", "GH").phoneE164).toBe("+233241234567");
    expect(normalizePhone("+233 30 212 3456", null, "GH").phoneE164).toBe("+233302123456");
    expect(normalizePhone(null, "054 123 4567", "gh").phoneE164).toBe("+233541234567");
  });

  it("flags an invalid number for review and keeps the raw value", () => {
    const p = normalizePhone(null, "12 34", "TG");
    expect(p).toEqual({ phoneRaw: "12 34", phoneE164: null, phoneDigits: "1234", phoneStatus: "needs_review" });
  });

  it("flags a national number without country as needs_review", () => {
    const p = normalizePhone(null, "90 12 34 56", null);
    expect(p.phoneE164).toBeNull();
    expect(p.phoneStatus).toBe("needs_review");
  });

  it("returns unknown when there is no phone", () => {
    expect(normalizePhone("  ", null, "TG")).toEqual({ phoneRaw: null, phoneE164: null, phoneDigits: null, phoneStatus: "unknown" });
  });

  it("falls back to the national value when the international one is malformed", () => {
    const p = normalizePhone("+228 1", "90 12 34 56", "TG");
    expect(p.phoneRaw).toBe("+228 1");
    expect(p.phoneE164).toBe("+22890123456");
  });
});

describe("website helpers", () => {
  it("derives a lower-case host without www", () => {
    expect(websiteHostOf("https://www.Hotel-Palmier.example/contact?x=1")).toBe("hotel-palmier.example");
    expect(websiteHostOf("http://shop.example.")).toBe("shop.example");
    expect(websiteHostOf("www.foo.example/page")).toBe("foo.example");
    expect(websiteHostOf("www.foo.example:8080/page")).toBe("foo.example");
  });

  it("rejects non-web or malformed URLs", () => {
    expect(websiteHostOf("mailto:info@foo.example")).toBeNull();
    expect(websiteHostOf("tel:+22890123456")).toBeNull();
    expect(websiteHostOf("javascript:alert(1)")).toBeNull();
    expect(websiteHostOf("ftp://foo.example")).toBeNull();
    expect(websiteHostOf("not a url")).toBeNull();
    expect(websiteHostOf("")).toBeNull();
    expect(websiteHostOf(null)).toBeNull();
  });

  it("knows shared platform hosts", () => {
    expect(isSharedPlatformHost("facebook.com")).toBe(true);
    expect(isSharedPlatformHost("m.facebook.com")).toBe(true);
    expect(isSharedPlatformHost("linktr.ee")).toBe(true);
    expect(isSharedPlatformHost("hotel-palmier.example")).toBe(false);
  });

  it("parses email domains and rejects junk", () => {
    expect(emailDomain("Info@Hotel.Example")).toBe("hotel.example");
    expect(emailDomain("nope")).toBeNull();
    expect(looksLikeEmail("contact@hotel.example")).toBe(true);
    expect(looksLikeEmail("contact@hotel")).toBe(false);
    expect(looksLikeEmail("two words@hotel.example")).toBe(false);
  });
});

describe("text helpers", () => {
  it("folds accents, case and punctuation", () => {
    expect(stripAccents("Lomé Hôtel Œuvre")).toBe("Lome Hotel OEuvre");
    expect(foldText("  L'Étoile  du-Golfe! ")).toBe("l etoile du golfe");
    expect(slugify("Hôtel Le Palmier d'Or")).toBe("hotel-le-palmier-d-or");
    expect(titleCase("web design agency")).toBe("Web Design Agency");
    expect(titleCase("électricien")).toBe("Électricien");
  });

  it("drops common words from name keys", () => {
    expect(nameKey("Hôtel Le Palmier d'Or")).toBe("palmier or");
    expect(nameKey("Le Palmier d'Or Hotel SARL")).toBe("palmier or");
    expect(nameKey("Hotel")).toBe("hotel");
  });

  it("scores name similarity independent of accents, case, common words and order", () => {
    expect(nameSimilarity("Hôtel Le Palmier d'Or", "HOTEL PALMIER D'OR")).toBe(1);
    expect(nameSimilarity("Palmier d'Or Hôtel", "Hôtel Le Palmier d'Or")).toBe(1);
    expect(nameSimilarity("Résidence Les Bougainvilliers", "Residence Les Bougainvillier")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Résidence Les Cocotiers", "Residence Les Cocotier")).toBeLessThan(0.9);
    expect(nameSimilarity("Hôtel Le Baobab", "Hôtel La Lagune")).toBeLessThan(0.5);
  });

  it("bounded Levenshtein matches the textbook algorithm within the bound", () => {
    const naive = (a: string, b: string) => {
      const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
      for (let j = 1; j <= b.length; j++) d[0]![j] = j;
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
          d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      return d[a.length]![b.length]!;
    };
    const words = ["", "a", "ab", "palmier", "palmeir", "cocotiers", "cocotier", "baobab", "lagune", "hotel du lac", "hotel du parc", "abcdefghij", "bcdefghijk"];
    for (const a of words) {
      for (const b of words) {
        const exact = naive(a, b);
        for (const max of [0, 1, 2, 3, 5, 20]) {
          const got = boundedLevenshtein(a, b, max);
          if (exact <= max) expect(got).toBe(exact);
          else expect(got).toBe(max + 1);
        }
      }
    }
  });
});

describe("normalizePlace", () => {
  it("keeps provider values and derives phone, host, statuses and quality", () => {
    const r = normalizePlace(place(), { source: "sample", retrievedAt: RETRIEVED });
    expect(r).toMatchObject({
      source: "sample",
      sourceRecordId: "rec-1",
      name: "Hôtel Le Palmier d'Or",
      category: "Hotel",
      categories: ["Hotel", "Lodging"],
      phoneRaw: "+228 90 12 34 56",
      phoneE164: "+22890123456",
      phoneDigits: "22890123456",
      phoneStatus: "source_provided",
      websiteUrl: "https://www.palmier-dor.example/",
      websiteHost: "palmier-dor.example",
      websiteStatus: "unknown",
      websiteCheck: null,
      providerEmail: null,
      primaryEmail: null,
      emailOrigin: null,
      emailStatus: "unknown",
      emails: [],
      socials: {},
      retrievedAt: RETRIEVED,
      qualityStatus: "complete",
      qualityIssues: [],
      enrichedAt: null,
      lastVerifiedAt: null,
      aiCategory: null,
    });
  });

  it("uses the national number as raw phone when no international one is given", () => {
    const r = normalizePlace(place({ phoneInternational: null }), { source: "sample" });
    expect(r.phoneRaw).toBe("90 12 34 56");
    expect(r.phoneE164).toBe("+22890123456");
  });

  it("flags an invalid phone as needs_review", () => {
    const r = normalizePlace(place({ phoneInternational: null, phoneNational: "000" }), { source: "sample" });
    expect(r.phoneE164).toBeNull();
    expect(r.phoneDigits).toBe("000");
    expect(r.phoneStatus).toBe("needs_review");
    expect(r.qualityStatus).toBe("needs_review");
    expect(r.qualityIssues).toContain("invalid_phone");
  });

  it("marks businesses without a website as none", () => {
    const r = normalizePlace(place({ websiteUrl: "   " }), { source: "sample" });
    expect(r.websiteUrl).toBeNull();
    expect(r.websiteHost).toBeNull();
    expect(r.websiteStatus).toBe("none");
  });

  it("takes a provider email as primary, lower-cased, never verified", () => {
    const r = normalizePlace(place({ email: " Info@Palmier-DOR.example " }), { source: "google_places" });
    expect(r.providerEmail).toBe("info@palmier-dor.example");
    expect(r.primaryEmail).toBe("info@palmier-dor.example");
    expect(r.emailOrigin).toBe("provider");
    expect(r.emailStatus).toBe("source_provided");
    expect(r.emails).toEqual([{ email: "info@palmier-dor.example", sourceUrl: "provider", sameDomain: true }]);
  });

  it("ignores a malformed provider email instead of repairing it", () => {
    const r = normalizePlace(place({ email: "call us" }), { source: "sample" });
    expect(r.providerEmail).toBeNull();
    expect(r.primaryEmail).toBeNull();
  });

  it("nulls empty strings and out-of-range numbers", () => {
    const r = normalizePlace(
      place({ name: "  ", address: "", city: " ", lat: 123, lng: 1, rating: 7, reviewCount: -3, categories: ["Hotel", " hotel ", ""] }),
      { source: "sample" },
    );
    expect(r.name).toBeNull();
    expect(r.address).toBeNull();
    expect(r.city).toBeNull();
    expect(r.lat).toBeNull();
    expect(r.lng).toBeNull();
    expect(r.rating).toBeNull();
    expect(r.reviewCount).toBeNull();
    expect(r.categories).toEqual(["Hotel"]);
    expect(r.qualityIssues).toEqual(expect.arrayContaining(["missing_name", "missing_address"]));
    expect(r.qualityStatus).toBe("incomplete");
  });

  it("reports missing phone, address and category as incomplete", () => {
    const r = normalizePlace(place({ phoneNational: null, phoneInternational: null, address: null, category: null }), { source: "sample" });
    expect(r.phoneStatus).toBe("unknown");
    expect(r.qualityIssues).toEqual(["missing_phone", "missing_address", "missing_category"]);
    expect(r.qualityStatus).toBe("incomplete");
  });
});

describe("computeQuality", () => {
  const complete = { name: "A", phoneRaw: "+228 90 12 34 56", phoneE164: "+22890123456", phoneStatus: "source_provided" as const, address: "Lomé", category: "Hotel" };

  it("is complete when name, phone, address and category are present", () => {
    expect(computeQuality(complete)).toEqual({ qualityStatus: "complete", qualityIssues: [] });
  });

  it("needs review when the website is unreachable", () => {
    expect(computeQuality({ ...complete, websiteStatus: "unreachable" })).toEqual({ qualityStatus: "needs_review", qualityIssues: ["website_unreachable"] });
  });

  it("needs review when the email is doubtful", () => {
    expect(computeQuality({ ...complete, primaryEmail: "x@y.example", emailStatus: "needs_review" })).toEqual({
      qualityStatus: "needs_review",
      qualityIssues: ["email_needs_review"],
    });
    // No email at all: the status alone is not an issue.
    expect(computeQuality({ ...complete, primaryEmail: null, emailStatus: "needs_review" }).qualityStatus).toBe("complete");
  });

  it("needs review wins over incomplete", () => {
    const q = computeQuality({ ...complete, address: null, phoneStatus: "needs_review", phoneE164: null });
    expect(q.qualityStatus).toBe("needs_review");
    expect(q.qualityIssues).toEqual(["missing_address", "invalid_phone"]);
  });

  it("keeps duplicate_candidate for records flagged by the search runner", () => {
    expect(computeQuality({ ...complete, duplicateOfId: "00000000-0000-0000-0000-000000000000" }).qualityStatus).toBe("duplicate_candidate");
  });

  it("reports every missing field on an empty record", () => {
    expect(computeQuality({})).toEqual({ qualityStatus: "incomplete", qualityIssues: ["missing_name", "missing_phone", "missing_address", "missing_category"] });
  });
});
