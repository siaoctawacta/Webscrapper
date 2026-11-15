import { describe, expect, it, vi } from "vitest";
import type { BusinessRow } from "@/lib/api-types";
import type { SourceId } from "@/lib/domain";
import type { AppUser } from "../auth/session";
import { HttpError } from "../errors";
import { nonPersistableFields } from "../providers/policy";
import type { BusinessProvider } from "../providers/types";
import type { UsageEntry } from "../usage";
import { DETAILS_BATCH_SIZE, hydrateRows, MAX_HYDRATED_ROWS, type HydrateDeps } from "./hydrate";
import { fakeProvider, livePlace } from "./test-fixtures";

const user: AppUser = { id: "user-1", name: "Ama", email: "ama@test.local", role: "member", status: "active" };
const GOOGLE_RESTRICTED = nonPersistableFields("google_places");

/** A lead row as stored for a Google place: provider fields NULL and listed as restricted. */
const googleRow = (i: number, o: Partial<BusinessRow> = {}): BusinessRow => ({
  id: `lead-${i}`,
  businessId: `biz-${i}`,
  source: "google_places",
  sourceRecordId: `ChIJplace${i}`,
  name: null,
  category: null,
  categories: [],
  phone: null,
  phoneE164: null,
  phoneStatus: "source_provided",
  website: null,
  websiteHost: null,
  websiteStatus: "present",
  websiteCheck: { status: "ok", https: true, checkedAt: "2026-11-01T00:00:00.000Z" },
  email: `info@place${i}.example`,
  emails: [{ email: `info@place${i}.example`, sourceUrl: `https://place${i}.example/contact`, sameDomain: true }],
  emailOrigin: "website_crawl",
  emailStatus: "source_provided",
  socials: { facebook: `https://facebook.com/place${i}` },
  address: null,
  city: null,
  region: null,
  country: null,
  postalCode: null,
  lat: null,
  lng: null,
  rating: null,
  reviewCount: null,
  mapsUrl: `https://maps.google.com/?cid=${i}`,
  businessStatus: null,
  qualityStatus: "complete",
  qualityIssues: [],
  duplicateOfId: null,
  aiCategory: null,
  retrievedAt: "2026-11-01T00:00:00.000Z",
  enrichedAt: null,
  lastVerifiedAt: null,
  restrictedFields: [...GOOGLE_RESTRICTED],
  liveFields: [],
  lead: {
    collectionId: "col-1",
    status: "contacted",
    tags: ["VIP"],
    notes: "Called",
    lastContactedAt: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  },
  ...o,
});

const sampleRow = (i: number): BusinessRow =>
  googleRow(i, { source: "sample", sourceRecordId: `sample-${i}`, name: `Sample ${i}`, phone: "+228 90 00 00 01", restrictedFields: [] });

function setup(provider: BusinessProvider | (() => never), extra: Partial<HydrateDeps> = {}) {
  const usage: UsageEntry[] = [];
  const getProvider = vi.fn((id: SourceId) => {
    if (id !== "google_places") throw new Error(`unexpected provider ${id}`);
    return typeof provider === "function" ? provider() : provider;
  });
  const deps: HydrateDeps = {
    getProvider,
    recordUsage: async (u) => {
      usage.push(u);
    },
    remainingAllowance: async () => null,
    ...extra,
  };
  return { deps, usage, getProvider };
}

const quiet = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
};

describe("hydrateRows", () => {
  it("never makes more billed lookups than the user's remaining monthly allowance", async () => {
    const { provider, calls } = fakeProvider([livePlace("ChIJplace1"), livePlace("ChIJplace2"), livePlace("ChIJplace3")]);
    let limited = 0;
    const two = setup(provider, { remainingAllowance: async () => 2, onLimited: () => limited++ });
    const out = await hydrateRows(user, [googleRow(1), googleRow(2), googleRow(3)], two.deps);
    expect(calls.flat()).toEqual(["ChIJplace1", "ChIJplace2"]);
    expect(out[2]!.liveFields).toEqual([]);
    expect(limited).toBe(1);

    const none = setup(provider, { remainingAllowance: async () => 0, onLimited: () => limited++ });
    const rows = [googleRow(4)];
    expect(await hydrateRows(user, rows, none.deps)).toEqual(rows);
    expect(none.getProvider).toHaveBeenCalled();
    expect(calls.flat()).toHaveLength(2);
    expect(limited).toBe(2);
  });

  it("fills only the restricted fields of Google rows and lists every one of them as live, even when empty", async () => {
    const { provider, calls, signals } = fakeProvider([
      livePlace("ChIJplace1", { websiteUrl: null, postalCode: null, mapsUrl: "https://elsewhere.example/" }),
    ]);
    const { deps, usage } = setup(provider);
    const before = googleRow(1);
    const snapshot = structuredClone(before);

    const [out] = await hydrateRows(user, [before], deps);

    expect(out).toMatchObject({
      name: "Live ChIJplace1",
      category: "Hotel",
      categories: ["hotel"],
      phone: "+228 90 12 34 56",
      phoneE164: "+22890123456",
      website: null, // the provider has none: shown as empty, not as "not stored"
      websiteHost: null,
      address: "Boulevard du 13 Janvier, Lomé",
      city: "Lomé",
      country: "Togo",
      rating: 4.6,
      reviewCount: 120,
      lat: 6.1319,
      lng: 1.2228,
      businessStatus: "OPERATIONAL",
      // stored / app-owned values are untouched
      mapsUrl: "https://maps.google.com/?cid=1",
      websiteStatus: "present",
      email: "info@place1.example",
      emails: snapshot.emails,
      socials: snapshot.socials,
      lead: snapshot.lead,
      restrictedFields: snapshot.restrictedFields,
    });
    expect([...out!.liveFields].sort()).toEqual([...GOOGLE_RESTRICTED].sort());
    expect(out!.liveFields).toContain("website");
    expect(out!.liveFields).toContain("postal_code");
    expect(before).toEqual(snapshot); // input not mutated

    expect(calls).toEqual([["ChIJplace1"]]);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(usage).toEqual([
      { userId: "user-1", provider: "google_places", operation: "place_details", requestCount: 1, billable: true, estimatedCostUsd: 0.02 },
    ]);
  });

  it("does not look anything up for sample rows or rows without restricted fields", async () => {
    const { provider, calls } = fakeProvider([]);
    const { deps, getProvider, usage } = setup(provider);
    const rows = [sampleRow(1), googleRow(2, { restrictedFields: [] })];
    const out = await hydrateRows(user, rows, deps);
    expect(out).toBe(rows);
    expect(getProvider).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(usage).toEqual([]);
  });

  it("hydrates Google rows in a mixed page and leaves sample rows and places the provider did not return as stored", async () => {
    const { provider, calls } = fakeProvider([livePlace("ChIJplace1"), livePlace("ChIJplace3")]);
    const { deps, usage } = setup(provider);
    const rows = [googleRow(1), sampleRow(2), googleRow(3), googleRow(4)];
    const out = await hydrateRows(user, rows, deps);

    expect(calls).toEqual([["ChIJplace1", "ChIJplace3", "ChIJplace4"]]);
    expect(out.map((r) => r.name)).toEqual(["Live ChIJplace1", "Sample 2", "Live ChIJplace3", null]);
    expect(out[1]).toBe(rows[1]);
    expect(out[3]).toBe(rows[3]); // removed place: still "not stored", no live fields
    expect(out[3]!.liveFields).toEqual([]);
    expect(usage).toHaveLength(3); // every request is billed, found or not
  });

  it("returns rows unchanged when the provider is not configured", async () => {
    quiet();
    const { deps, usage } = setup(() => {
      throw new HttpError("bad_request", "Google Maps is not configured (GOOGLE_MAPS_API_KEY is missing)");
    });
    const rows = [googleRow(1), googleRow(2)];
    const out = await hydrateRows(user, rows, deps);
    expect(out).toEqual(rows);
    expect(out.every((r) => r.name === null && r.liveFields.length === 0)).toBe(true);
    expect(usage).toEqual([]);
  });

  it("returns rows unchanged when the provider fails, but still records the requests it made", async () => {
    quiet();
    const { provider } = fakeProvider([livePlace("ChIJplace1")], { fail: true });
    const { deps, usage } = setup(provider);
    const rows = [googleRow(1), googleRow(2)];
    const snapshot = structuredClone(rows);
    const out = await hydrateRows(user, rows, deps);
    expect(out).toEqual(snapshot);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ userId: user.id, billable: true, operation: "place_details" });
  });

  it("drops a whole source's live data when a later batch fails (no half-hydrated pages)", async () => {
    quiet();
    const rows = Array.from({ length: DETAILS_BATCH_SIZE + 20 }, (_, i) => googleRow(i));
    const { provider, calls } = fakeProvider(
      rows.map((r) => livePlace(r.sourceRecordId)),
      { failOnCall: 2 },
    );
    const { deps } = setup(provider, { maxRows: 500 });
    const out = await hydrateRows(user, rows, deps);
    expect(calls.map((c) => c.length)).toEqual([DETAILS_BATCH_SIZE, 20]);
    expect(out).toEqual(rows);
  });

  it("never throws, even on unexpected errors or when usage cannot be recorded", async () => {
    quiet();
    const broken = setup(() => {
      throw new Error("boom");
    });
    const rows = [googleRow(1)];
    await expect(hydrateRows(user, rows, broken.deps)).resolves.toBe(rows);

    const { provider } = fakeProvider([livePlace("ChIJplace1")]);
    const out = await hydrateRows(user, rows, {
      getProvider: () => provider,
      recordUsage: async () => {
        throw new Error("database down");
      },
    });
    expect(out[0]!.name).toBe("Live ChIJplace1");
  });

  it("batches ids, de-duplicates them, and hydrates at most one page of rows", async () => {
    const many = Array.from({ length: 150 }, (_, i) => googleRow(i));
    const a = fakeProvider(many.map((r) => livePlace(r.sourceRecordId)));
    const outA = await hydrateRows(user, many, setup(a.provider, { maxRows: 1000 }).deps);
    expect(a.calls.map((c) => c.length)).toEqual([100, 50]);
    expect(outA.every((r) => r.name?.startsWith("Live "))).toBe(true);

    const b = fakeProvider(many.map((r) => livePlace(r.sourceRecordId)));
    const outB = await hydrateRows(user, many, setup(b.provider).deps);
    expect(b.calls.flat()).toHaveLength(MAX_HYDRATED_ROWS);
    expect(outB[MAX_HYDRATED_ROWS - 1]!.name).not.toBeNull();
    expect(outB[MAX_HYDRATED_ROWS]!.name).toBeNull();

    // The same place twice (e.g. getLeadsByIds across leads of one business) is looked up once.
    const c = fakeProvider([livePlace("ChIJplace7")]);
    const twice = [googleRow(7), googleRow(7, { id: "lead-7b" })];
    const outC = await hydrateRows(user, twice, setup(c.provider).deps);
    expect(c.calls).toEqual([["ChIJplace7"]]);
    expect(outC.map((r) => r.name)).toEqual(["Live ChIJplace7", "Live ChIJplace7"]);
  });

  it("gives up on a provider that does not answer in time", async () => {
    quiet();
    const { provider } = fakeProvider([livePlace("ChIJplace1")], { hang: true });
    const rows = [googleRow(1)];
    const started = Date.now();
    const out = await hydrateRows(user, rows, setup(provider, { timeoutMs: 30 }).deps);
    expect(out).toEqual(rows);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
