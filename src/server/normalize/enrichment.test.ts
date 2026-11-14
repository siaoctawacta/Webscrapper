import { describe, expect, it } from "vitest";
import type { WebsiteCheck } from "@/lib/domain";
import type { EnrichmentResult } from "../enrichment";
import type { ProviderPlace } from "../providers/types";
import { applyEnrichment, normalizePlace, sampleEnrichmentToResult, websiteStatusFromCheck, type NormalizedBusiness } from "./index";

const AT = new Date("2026-03-04T05:06:07.000Z");

function record(overrides: Partial<ProviderPlace> = {}): NormalizedBusiness {
  return normalizePlace(
    {
      sourceRecordId: "r1",
      name: "Golden Palm Lodge",
      category: "Lodge",
      categories: ["Lodge", "Hotel"],
      phoneNational: "024 123 4567",
      phoneInternational: "+233 24 123 4567",
      websiteUrl: "https://goldenpalm.example",
      email: null,
      address: "12 Oxford Street, Osu, Accra",
      city: "Accra",
      region: "Greater Accra",
      country: "Ghana",
      countryCode: "GH",
      postalCode: null,
      lat: 5.556,
      lng: -0.1969,
      rating: 4.5,
      reviewCount: 88,
      mapsUrl: null,
      businessStatus: "OPERATIONAL",
      ...overrides,
    },
    { source: "sample", retrievedAt: AT },
  );
}

const check = (status: WebsiteCheck["status"], extra: Partial<WebsiteCheck> = {}): WebsiteCheck => ({ status, checkedAt: AT.toISOString(), ...extra });

function result(overrides: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    websiteStatus: "present",
    websiteCheck: check("ok", { https: true, finalUrl: "https://goldenpalm.example/", title: "Golden Palm Lodge" }),
    emails: [],
    socials: {},
    phones: [],
    mx: {},
    ...overrides,
  };
}

describe("websiteStatusFromCheck", () => {
  it("maps crawl outcomes to website status", () => {
    expect(websiteStatusFromCheck("ok")).toBe("present");
    expect(websiteStatusFromCheck("blocked_by_robots")).toBe("present");
    expect(websiteStatusFromCheck("unreachable")).toBe("unreachable");
    expect(websiteStatusFromCheck("error")).toBe("unreachable");
    expect(websiteStatusFromCheck("skipped")).toBeNull();
  });
});

describe("applyEnrichment", () => {
  it("records a reachable site with the best crawled email", () => {
    const r = record();
    const changes = applyEnrichment(
      r,
      result({
        emails: [
          { email: "Info@GoldenPalm.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: true },
          { email: "goldenpalm@mail.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: false },
        ],
        socials: { facebook: "https://facebook.example/goldenpalm" },
      }),
      AT,
    );
    expect(changes).toMatchObject({
      websiteStatus: "present",
      primaryEmail: "info@goldenpalm.example",
      emailOrigin: "website_crawl",
      emailStatus: "source_provided",
      socials: { facebook: "https://facebook.example/goldenpalm" },
      enrichedAt: AT,
      qualityStatus: "complete",
      qualityIssues: [],
    });
    expect(changes.emails).toEqual([
      { email: "info@goldenpalm.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: true },
      { email: "goldenpalm@mail.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: false },
    ]);
    expect(changes.websiteCheck?.title).toBe("Golden Palm Lodge");
  });

  it("keeps the provider email first and primary, de-duplicating case-insensitively", () => {
    const r = record({ email: "Bookings@GoldenPalm.example" });
    const changes = applyEnrichment(
      r,
      result({
        emails: [
          { email: "BOOKINGS@goldenpalm.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: true },
          { email: "info@goldenpalm.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: true },
        ],
      }),
      AT,
    );
    expect(changes.primaryEmail).toBe("bookings@goldenpalm.example");
    expect(changes.emailOrigin).toBe("provider");
    expect(changes.emails?.map((e) => [e.email, e.sourceUrl])).toEqual([
      ["bookings@goldenpalm.example", "provider"],
      ["info@goldenpalm.example", "https://goldenpalm.example/contact"],
    ]);
  });

  it("flags the email for review when its domain has no mail server", () => {
    const changes = applyEnrichment(
      record(),
      result({ emails: [{ email: "info@goldenpalm.example", sourceUrl: "https://goldenpalm.example/", sameDomain: true }], mx: { "goldenpalm.example": false } }),
      AT,
    );
    expect(changes.emailStatus).toBe("needs_review");
    expect(changes.qualityStatus).toBe("needs_review");
    expect(changes.qualityIssues).toEqual(["email_needs_review"]);
  });

  it("an MX check that passed keeps source_provided", () => {
    const changes = applyEnrichment(
      record(),
      result({ emails: [{ email: "info@goldenpalm.example", sourceUrl: "https://goldenpalm.example/", sameDomain: true }], mx: { "goldenpalm.example": true } }),
    );
    expect(changes.emailStatus).toBe("source_provided");
  });

  it("marks unreachable and error sites and lowers quality", () => {
    for (const status of ["unreachable", "error"] as const) {
      const changes = applyEnrichment(record(), result({ websiteStatus: "unreachable", websiteCheck: check(status, { error: "Timed out" }) }), AT);
      expect(changes.websiteStatus).toBe("unreachable");
      expect(changes.qualityStatus).toBe("needs_review");
      expect(changes.qualityIssues).toContain("website_unreachable");
      expect(changes.primaryEmail).toBeNull();
      expect(changes.emailStatus).toBe("unknown");
    }
  });

  it("robots.txt blocks still count as a present website", () => {
    const changes = applyEnrichment(record(), result({ websiteCheck: check("blocked_by_robots") }), AT);
    expect(changes.websiteStatus).toBe("present");
    expect(changes.qualityStatus).toBe("complete");
  });

  it("a skipped visit leaves the website status unchanged", () => {
    const changes = applyEnrichment(record(), result({ websiteStatus: "unknown", websiteCheck: check("skipped") }), AT);
    expect("websiteStatus" in changes).toBe(false);
    expect(changes.websiteCheck?.status).toBe("skipped");
    expect(changes.enrichedAt).toEqual(AT);
  });

  it("never turns a business without a website into one that has a website", () => {
    const changes = applyEnrichment(record({ websiteUrl: null }), result(), AT);
    expect("websiteStatus" in changes).toBe(false);
  });

  it("merges socials and keeps emails found on an earlier visit after the new ones", () => {
    const first = record();
    const firstChanges = applyEnrichment(
      first,
      result({ emails: [{ email: "old@goldenpalm.example", sourceUrl: "https://goldenpalm.example/about", sameDomain: true }], socials: { facebook: "https://facebook.example/a" } }),
      AT,
    );
    const second = { ...first, ...firstChanges } as NormalizedBusiness;
    const changes = applyEnrichment(
      second,
      result({ emails: [{ email: "new@goldenpalm.example", sourceUrl: "https://goldenpalm.example/contact", sameDomain: true }], socials: { instagram: "https://instagram.example/a" } }),
      AT,
    );
    expect(changes.emails?.map((e) => e.email)).toEqual(["new@goldenpalm.example", "old@goldenpalm.example"]);
    expect(changes.primaryEmail).toBe("new@goldenpalm.example");
    expect(changes.socials).toEqual({ facebook: "https://facebook.example/a", instagram: "https://instagram.example/a" });
  });

  it("does not use crawled tel: links as the business phone", () => {
    const changes = applyEnrichment(record({ phoneInternational: null, phoneNational: null }), result({ phones: ["+233 24 999 9999"] }), AT);
    expect(changes).not.toHaveProperty("phoneRaw");
    expect(changes.qualityIssues).toContain("missing_phone");
  });
});

describe("sampleEnrichmentToResult", () => {
  const base: ProviderPlace = {
    sourceRecordId: "s",
    name: "X",
    category: null,
    categories: [],
    phoneNational: null,
    phoneInternational: null,
    websiteUrl: "https://x.example",
    email: null,
    address: null,
    city: null,
    region: null,
    country: null,
    countryCode: null,
    postalCode: null,
    lat: null,
    lng: null,
    rating: null,
    reviewCount: null,
    mapsUrl: null,
    businessStatus: null,
  };

  it("returns null when the place has no sample enrichment", () => {
    expect(sampleEnrichmentToResult(base)).toBeNull();
  });

  it("converts sample enrichment without network access", () => {
    const e = sampleEnrichmentToResult({
      ...base,
      sampleEnrichment: {
        emails: [{ email: "contact@x.example", sourceUrl: "https://x.example/contact", sameDomain: true }],
        socials: { facebook: "https://facebook.example/x" },
        websiteCheck: check("ok", { https: true }),
      },
    });
    expect(e).toEqual({
      websiteStatus: "present",
      websiteCheck: check("ok", { https: true }),
      emails: [{ email: "contact@x.example", sourceUrl: "https://x.example/contact", sameDomain: true }],
      socials: { facebook: "https://facebook.example/x" },
      phones: [],
      mx: {},
    });
  });

  it("uses a skipped check when the sample has no website check", () => {
    const e = sampleEnrichmentToResult({ ...base, sampleEnrichment: { emails: [], socials: {}, websiteCheck: null } }, AT);
    expect(e?.websiteCheck).toEqual({ status: "skipped", checkedAt: AT.toISOString() });
    expect(e?.websiteStatus).toBe("unknown");
  });
});
