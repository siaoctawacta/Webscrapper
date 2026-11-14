import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { BusinessRow, ListResponse } from "@/lib/api-types";
import type { AppUser } from "@/server/auth/session";
import { closeDb, db } from "@/server/db";
import { businesses, leads, usageLogs } from "@/server/db/schema";
import type { BusinessProvider } from "@/server/providers/types";
import { addToCollection, createCollection, getLeadRow, getLeadsByIds, listLeads } from "@/server/collections";
import { defaultListQuery } from "@/lib/list-query";
import {
  apiRequest,
  createTestUser,
  ctx,
  fakeProvider,
  googleSpec,
  insertJob,
  insertResults,
  livePlace,
  resetDb,
  sampleSpec,
  type TestUser,
} from "@/server/collections/test-fixtures";
import { PATCH as patchLeadRoute } from "../../../leads/[id]/route";
import { GET } from "./route";

/** The Google provider the registry hands out; null = "not configured" (as in tests without a key). */
const registry = vi.hoisted(() => ({ google: null as BusinessProvider | null }));

vi.mock("@/server/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/providers/registry")>();
  const { HttpError } = await import("@/server/errors");
  return {
    ...actual,
    getProvider: (id: Parameters<typeof actual.getProvider>[0]) => {
      if (id !== "google_places") return actual.getProvider(id);
      if (!registry.google) throw new HttpError("bad_request", "Google Maps is not configured (GOOGLE_MAPS_API_KEY is missing)");
      return registry.google;
    },
  };
});

beforeEach(async () => {
  registry.google = null;
  vi.restoreAllMocks();
  await resetDb();
});
afterAll(closeDb);

const appUser = (u: TestUser): AppUser => ({ id: u.id, email: u.email, name: "Test", role: "member", status: "active" });

async function seed(googleCount = 3) {
  const user = await createTestUser();
  const u = appUser(user);
  const c = await createCollection(u, { name: "Lomé" });
  const job = await insertJob(user.id, { provider: "google_places" });
  const specs = [...Array.from({ length: googleCount }, (_, i) => googleSpec(i + 1)), sampleSpec(99, { name: "Sample Lodge" })];
  const results = await insertResults(job, specs);
  await addToCollection(u, c.id, { jobId: job.id, resultIds: results.map((r) => r.id) });
  return { user, u, c, job };
}

const getLeads = async (user: TestUser, collectionId: string, qs = "") => {
  const res = await GET(apiRequest(`/api/v1/collections/${collectionId}/leads?${qs}`, { user }), ctx({ id: collectionId }));
  return { res, body: (await res.json()) as ListResponse };
};

const bySrid = (rows: BusinessRow[], srid: string) => rows.find((r) => r.sourceRecordId === srid)!;

describe("live hydration of collection leads", () => {
  it("loads restricted Google fields live for the page, records billable usage and never stores them", async () => {
    const { user, c } = await seed(3);
    const { provider, calls } = fakeProvider([livePlace("ChIJgoogle1"), livePlace("ChIJgoogle2", { phoneInternational: null, phoneNational: null })]);
    registry.google = provider;

    const { res, body } = await getLeads(user, c.id);
    expect(res.status).toBe(200);
    expect(calls.flat().sort()).toEqual(["ChIJgoogle1", "ChIJgoogle2", "ChIJgoogle3"]);

    const g1 = bySrid(body.rows, "ChIJgoogle1");
    expect(g1).toMatchObject({ name: "Live ChIJgoogle1", phone: "+228 90 12 34 56", rating: 4.6, mapsUrl: "https://maps.google.com/?cid=1", email: "contact@biz1.example" });
    expect(g1.liveFields).toEqual(expect.arrayContaining(["business_name", "phone", "website", "address", "rating"]));
    expect(g1.restrictedFields).toContain("business_name");

    // Live lookup without a phone: shown as empty (phone is in liveFields), not as "not stored".
    const g2 = bySrid(body.rows, "ChIJgoogle2");
    expect(g2.phone).toBeNull();
    expect(g2.liveFields).toContain("phone");

    // A place Google no longer returns stays as stored.
    const g3 = bySrid(body.rows, "ChIJgoogle3");
    expect(g3).toMatchObject({ name: null, liveFields: [] });
    expect(g3.restrictedFields).toContain("business_name");

    const sample = bySrid(body.rows, "sample-99");
    expect(sample).toMatchObject({ name: "Sample Lodge", liveFields: [], restrictedFields: [] });

    const usage = await db().select().from(usageLogs);
    expect(usage).toHaveLength(3);
    for (const u of usage) {
      expect(u).toMatchObject({ userId: user.id, provider: "google_places", operation: "place_details", requestCount: 1, billable: true });
    }

    const stored = await db().select().from(businesses).where(eq(businesses.source, "google_places"));
    expect(stored).toHaveLength(3);
    expect(stored.every((b) => b.name === null && b.phoneRaw === null && b.rating === null && b.websiteUrl === null)).toBe(true);
  });

  it("only looks up the rows on the requested page", async () => {
    const { user, c } = await seed(30);
    const { provider, calls } = fakeProvider([]);
    registry.google = provider;
    await getLeads(user, c.id, "page_size=25");
    expect(calls.flat()).toHaveLength(25);
    await getLeads(user, c.id, "page_size=25&page=2");
    expect(calls.flat()).toHaveLength(25 + 5); // page 2 holds 5 Google rows + the sample row
  });

  it("still answers when Google fails: restricted fields stay empty and are reported as not stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, c } = await seed(2);
    registry.google = fakeProvider([livePlace("ChIJgoogle1")], { fail: true }).provider;
    const { res, body } = await getLeads(user, c.id);
    expect(res.status).toBe(200);
    const g1 = bySrid(body.rows, "ChIJgoogle1");
    expect(g1).toMatchObject({ name: null, phone: null, liveFields: [] });
    expect(g1.restrictedFields).toEqual(expect.arrayContaining(["business_name", "phone"]));
    expect(body.total).toBe(3);
    // The request Google did receive is still logged as billable.
    expect((await db().select().from(usageLogs)).length).toBeGreaterThanOrEqual(1);
  });

  it("works without a Google key (nothing loaded live, no usage)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { user, c } = await seed(1);
    const { body } = await getLeads(user, c.id);
    expect(bySrid(body.rows, "ChIJgoogle1")).toMatchObject({ name: null, liveFields: [] });
    expect(await db().select().from(usageLogs)).toHaveLength(0);
  });

  it("getLeadRow and getLeadsByIds hydrate by default; hydrate:false and lead PATCH make no live lookup", async () => {
    const { user, u, c } = await seed(2);
    const { provider, calls } = fakeProvider([livePlace("ChIJgoogle1"), livePlace("ChIJgoogle2")]);
    registry.google = provider;
    const ids = (await db().select().from(leads).where(eq(leads.collectionId, c.id))).map((l) => l.id);

    const rows = await getLeadsByIds(u, c.id, [...ids, "not-a-uuid", "00000000-0000-4000-8000-000000000000"], { sort: [{ field: "business_name", direction: "asc" }] });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.source === "google_places").every((r) => r.name?.startsWith("Live "))).toBe(true);
    const callsAfterIds = calls.length;

    const plain = await getLeadsByIds(u, c.id, ids, undefined, { hydrate: false });
    expect(plain.filter((r) => r.source === "google_places").every((r) => r.name === null)).toBe(true);
    const page = await listLeads(u, c.id, defaultListQuery(), { hydrate: false });
    expect(page.rows.filter((r) => r.source === "google_places").every((r) => r.liveFields.length === 0)).toBe(true);
    expect(calls.length).toBe(callsAfterIds);

    const googleLead = rows.find((r) => r.sourceRecordId === "ChIJgoogle1")!;
    expect((await getLeadRow(u, googleLead.id)).name).toBe("Live ChIJgoogle1");
    const before = calls.length;
    const res = await patchLeadRoute(
      apiRequest(`/api/v1/leads/${googleLead.id}`, { method: "PATCH", body: { notes: "Visit on Friday" }, user }),
      ctx({ id: googleLead.id }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as BusinessRow).lead?.notes).toBe("Visit on Friday");
    expect(calls.length).toBe(before);

    // Another user can read none of it.
    const intruder = appUser(await createTestUser());
    await expect(getLeadsByIds(intruder, c.id, ids)).rejects.toMatchObject({ status: 404 });
    await expect(getLeadRow(intruder, googleLead.id)).rejects.toMatchObject({ status: 404 });
  });
});
