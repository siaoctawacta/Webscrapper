import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { ApiError, BusinessRow, CollectionDto, ListResponse } from "@/lib/api-types";
import { closeDb, db } from "@/server/db";
import { auditLogs, businesses, leads } from "@/server/db/schema";
import {
  apiRequest,
  createTestUser,
  ctx,
  googleSpec,
  insertJob,
  insertResults,
  resetDb,
  sampleSpec,
  type TestUser,
} from "@/server/collections/test-fixtures";
import { GET as listCollectionsRoute, POST as createCollectionRoute } from "./route";
import { DELETE as deleteCollectionRoute, GET as getCollectionRoute, PATCH as patchCollectionRoute } from "./[id]/route";
import { GET as listLeadsRoute, POST as addLeadsRoute } from "./[id]/leads/route";
import { GET as leadIdsRoute } from "./[id]/leads/ids/route";

beforeEach(resetDb);
afterAll(closeDb);

const createCollection = async (user: TestUser, body: unknown) =>
  createCollectionRoute(apiRequest("/api/v1/collections", { method: "POST", body, user }), ctx({}));

async function newCollection(user: TestUser, name = "Lomé hotels"): Promise<CollectionDto> {
  const res = await createCollection(user, { name });
  expect(res.status).toBe(201);
  return (await res.json()) as CollectionDto;
}

const addLeads = (user: TestUser, collectionId: string, body: unknown) =>
  addLeadsRoute(apiRequest(`/api/v1/collections/${collectionId}/leads`, { method: "POST", body, user }), ctx({ id: collectionId }));

const listLeads = async (user: TestUser, collectionId: string, qs = "") => {
  const res = await listLeadsRoute(apiRequest(`/api/v1/collections/${collectionId}/leads?${qs}`, { user }), ctx({ id: collectionId }));
  return { res, body: (await res.json()) as ListResponse };
};

describe("collections CRUD", () => {
  it("creates, lists, renames and deletes a collection", async () => {
    const user = await createTestUser();
    const c = await newCollection(user, "  Lomé   hotels ");
    expect(c).toMatchObject({ name: "Lomé hotels", description: null, leadCount: 0, statusCounts: {} });

    const list = await listCollectionsRoute(apiRequest("/api/v1/collections", { user }), ctx({}));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { collections: CollectionDto[] }).collections.map((x) => x.name)).toEqual(["Lomé hotels"]);

    const patched = await patchCollectionRoute(
      apiRequest(`/api/v1/collections/${c.id}`, { method: "PATCH", body: { name: "Accra salons", description: "No website yet" }, user }),
      ctx({ id: c.id }),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ name: "Accra salons", description: "No website yet" });

    const cleared = await patchCollectionRoute(
      apiRequest(`/api/v1/collections/${c.id}`, { method: "PATCH", body: { description: null }, user }),
      ctx({ id: c.id }),
    );
    expect(await cleared.json()).toMatchObject({ name: "Accra salons", description: null });

    const del = await deleteCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { method: "DELETE", user }), ctx({ id: c.id }));
    expect(del.status).toBe(204);
    const gone = await getCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { user }), ctx({ id: c.id }));
    expect(gone.status).toBe(404);

    const actions = (await db().select({ action: auditLogs.action }).from(auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["collection.create", "collection.update", "collection.delete"]));
  });

  it("rejects a duplicate name case-insensitively with 409", async () => {
    const user = await createTestUser();
    await newCollection(user, "Lomé Hotels");
    const dup = await createCollection(user, { name: "lomé hotels" });
    expect(dup.status).toBe(409);
    const err = (await dup.json()) as ApiError;
    expect(err.error).toMatchObject({ code: "conflict", message: "You already have a collection called “lomé hotels”." });

    const other = await newCollection(user, "Accra");
    const rename = await patchCollectionRoute(
      apiRequest(`/api/v1/collections/${other.id}`, { method: "PATCH", body: { name: "LOMÉ HOTELS" }, user }),
      ctx({ id: other.id }),
    );
    expect(rename.status).toBe(409);

    // Changing only the casing of its own name is fine.
    const recase = await patchCollectionRoute(
      apiRequest(`/api/v1/collections/${other.id}`, { method: "PATCH", body: { name: "ACCRA" }, user }),
      ctx({ id: other.id }),
    );
    expect(recase.status).toBe(200);

    // Another user may use the same name.
    const someoneElse = await createTestUser();
    expect((await createCollection(someoneElse, { name: "Lomé Hotels" })).status).toBe(201);
  });

  it("validates names", async () => {
    const user = await createTestUser();
    expect((await createCollection(user, { name: "   " })).status).toBe(422);
    expect((await createCollection(user, { name: "x".repeat(81) })).status).toBe(422);
    expect((await createCollection(user, {})).status).toBe(422);
  });

  it("returns 404 for other users' collections and garbage ids", async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const c = await newCollection(owner);
    const job = await insertJob(intruder.id);
    const [r] = await insertResults(job, [sampleSpec(1)]);

    expect((await getCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { user: intruder }), ctx({ id: c.id }))).status).toBe(404);
    expect(
      (await patchCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { method: "PATCH", body: { name: "Mine" }, user: intruder }), ctx({ id: c.id })))
        .status,
    ).toBe(404);
    expect((await deleteCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { method: "DELETE", user: intruder }), ctx({ id: c.id }))).status).toBe(404);
    expect((await listLeads(intruder, c.id)).res.status).toBe(404);
    expect((await leadIdsRoute(apiRequest(`/api/v1/collections/${c.id}/leads/ids`, { user: intruder }), ctx({ id: c.id }))).status).toBe(404);
    expect((await addLeads(intruder, c.id, { jobId: job.id, resultIds: [r!.id] })).status).toBe(404);
    expect((await getCollectionRoute(apiRequest(`/api/v1/collections/not-a-uuid`, { user: owner }), ctx({ id: "not-a-uuid" }))).status).toBe(404);
    // The owner's collection still exists.
    expect((await getCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { user: owner }), ctx({ id: c.id }))).status).toBe(200);
  });

  it("requires sign-in", async () => {
    const res = await listCollectionsRoute(apiRequest("/api/v1/collections"), ctx({}));
    expect(res.status).toBe(401);
  });
});

describe("adding search results", () => {
  it("adds by ids, skips leads already saved, and counts statuses", async () => {
    const user = await createTestUser();
    const c = await newCollection(user);
    const job = await insertJob(user.id);
    const results = await insertResults(job, [sampleSpec(1), sampleSpec(2), sampleSpec(3)]);

    const first = await addLeads(user, c.id, { jobId: job.id, resultIds: [results[0]!.id, results[1]!.id] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ added: 2, skipped: 0 });

    const second = await addLeads(user, c.id, { jobId: job.id, resultIds: results.map((r) => r.id) });
    expect(await second.json()).toEqual({ added: 1, skipped: 2 });

    const dto = (await (await getCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { user }), ctx({ id: c.id }))).json()) as CollectionDto;
    expect(dto).toMatchObject({ leadCount: 3, statusCounts: { new: 3 } });

    // Saved in the results' order (newest first, then provider position).
    const { body } = await listLeads(user, c.id);
    expect(body.rows.map((r) => r.name)).toEqual(["Sample Biz 3", "Sample Biz 1", "Sample Biz 2"]);

    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "collection.add"));
    expect(audits).toHaveLength(2);
    expect(audits[1]!.metadata).toMatchObject({ mode: "ids", added: 1, skipped: 2 });
  });

  it("re-saving the same business into another collection reuses one business record", async () => {
    const user = await createTestUser();
    const a = await newCollection(user, "A");
    const b = await newCollection(user, "B");
    const job = await insertJob(user.id);
    const [r] = await insertResults(job, [sampleSpec(1)]);
    await addLeads(user, a.id, { jobId: job.id, resultIds: [r!.id] });
    await addLeads(user, b.id, { jobId: job.id, resultIds: [r!.id] });
    expect(await db().select().from(businesses)).toHaveLength(1);
    expect(await db().select().from(leads)).toHaveLength(2);
  });

  it("adds every result matching a results-grid query", async () => {
    const user = await createTestUser();
    const c = await newCollection(user);
    const job = await insertJob(user.id);
    await insertResults(job, [
      sampleSpec(1, { websiteStatus: "none", websiteUrl: null, websiteHost: null }),
      sampleSpec(2, { websiteStatus: "present" }),
      sampleSpec(3, { websiteStatus: "none", websiteUrl: null, websiteHost: null, category: "Restaurant" }),
      sampleSpec(4, { websiteStatus: "unreachable" }),
    ]);

    const res = await addLeads(user, c.id, { jobId: job.id, query: { filters: { has_website: false } } });
    expect(await res.json()).toEqual({ added: 2, skipped: 0 });

    const res2 = await addLeads(user, c.id, { jobId: job.id, query: { filters: {}, search: "Sample" } });
    expect(await res2.json()).toEqual({ added: 2, skipped: 2 });

    const bad = await addLeads(user, c.id, { jobId: job.id, query: { filters: { lead_status: ["new"] } } });
    expect(bad.status).toBe(422);
    const both = await addLeads(user, c.id, { jobId: job.id, query: {}, resultIds: ["00000000-0000-4000-8000-000000000000"] });
    expect(both.status).toBe(422);
  });

  it("ignores result ids from other jobs or users, and 404s for someone else's job", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    const c = await newCollection(user);
    const myJob = await insertJob(user.id);
    const otherJob = await insertJob(other.id);
    const [mine] = await insertResults(myJob, [sampleSpec(1)]);
    const [theirs] = await insertResults(otherJob, [sampleSpec(2)]);

    const res = await addLeads(user, c.id, { jobId: myJob.id, resultIds: [mine!.id, theirs!.id] });
    expect(await res.json()).toEqual({ added: 1, skipped: 0 });

    const steal = await addLeads(user, c.id, { jobId: otherJob.id, resultIds: [theirs!.id] });
    expect(steal.status).toBe(404);
    expect(((await steal.json()) as ApiError).error.message).toBe("Search not found");
  });

  it("explains when the search results have expired", async () => {
    const user = await createTestUser();
    const c = await newCollection(user);
    const job = await insertJob(user.id, { resultsPurgedAt: new Date() });
    const res = await addLeads(user, c.id, { jobId: job.id, query: {} });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiError).error.message).toMatch(/expired/);
  });
});

describe("source policy on save", () => {
  it("stores Google rows without restricted provider fields but keeps place id, maps link and app-owned data", async () => {
    const user = await createTestUser();
    const c = await newCollection(user);
    const job = await insertJob(user.id, { provider: "google_places" });
    const [g] = await insertResults(job, [googleSpec(1)]);
    await addLeads(user, c.id, { jobId: job.id, resultIds: [g!.id] });

    const [b] = await db().select().from(businesses).where(eq(businesses.userId, user.id));
    expect(b).toMatchObject({
      source: "google_places",
      sourceRecordId: "ChIJgoogle1",
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
      rating: null,
      reviewCount: null,
      lat: null,
      lng: null,
      websiteStatus: "present",
      primaryEmail: "contact@biz1.example",
      emailStatus: "source_provided",
      socials: { facebook: "https://facebook.com/biz1" },
    });
    expect(b!.emails).toEqual([{ email: "contact@biz1.example", sourceUrl: "https://biz1.example/contact", sameDomain: true }]);
    expect(b!.restrictedFields).toEqual(expect.arrayContaining(["business_name", "phone", "website", "address", "category", "rating"]));
    expect(b!.restrictedFields).not.toContain("maps_url");
    expect(b!.restrictedFields).not.toContain("source_record_id");

    // Without a Google key nothing is loaded live: restricted fields stay empty and are reported.
    const { body } = await listLeads(user, c.id);
    expect(body.rows[0]).toMatchObject({ name: null, phone: null, website: null, mapsUrl: "https://maps.google.com/?cid=1", email: "contact@biz1.example", liveFields: [] });
    expect(body.rows[0]!.restrictedFields).toContain("business_name");
    expect(body.policies.map((p) => p.source)).toEqual(["google_places"]);
    expect(body.policies[0]!.attribution).toBe("Data from Google Maps");
  });

  it("stores sample rows in full", async () => {
    const user = await createTestUser();
    const c = await newCollection(user);
    const job = await insertJob(user.id);
    const [s] = await insertResults(job, [sampleSpec(7)]);
    await addLeads(user, c.id, { jobId: job.id, resultIds: [s!.id] });
    const [b] = await db().select().from(businesses).where(eq(businesses.userId, user.id));
    expect(b).toMatchObject({
      name: "Sample Biz 7",
      category: "Hotel",
      categories: ["hotel", "lodging"],
      phoneRaw: s!.phoneRaw,
      phoneE164: s!.phoneE164,
      websiteUrl: "https://biz7.example/",
      websiteHost: "biz7.example",
      address: s!.address,
      city: "Lomé",
      rating: 4.2,
      reviewCount: 37,
      lat: 6.13,
      lng: 1.22,
      restrictedFields: [],
    });
  });

  it("refreshes a stored record from a newer search but not from an older one", async () => {
    const user = await createTestUser();
    const c = await newCollection(user);
    const newer = await insertJob(user.id);
    const older = await insertJob(user.id);
    const [fresh] = await insertResults(newer, [sampleSpec(1, { rating: 4.9, retrievedAt: new Date("2026-11-10T00:00:00Z") })]);
    const [stale] = await insertResults(older, [sampleSpec(1, { rating: 3.0, retrievedAt: new Date("2026-10-01T00:00:00Z") })]);
    await addLeads(user, c.id, { jobId: newer.id, resultIds: [fresh!.id] });
    const c2 = await newCollection(user, "Second");
    expect(await (await addLeads(user, c2.id, { jobId: older.id, resultIds: [stale!.id] })).json()).toEqual({ added: 1, skipped: 0 });
    const rows = await db().select().from(businesses).where(and(eq(businesses.userId, user.id), eq(businesses.sourceRecordId, "sample-1")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(4.9);
  });
});

describe("listing leads", () => {
  async function seeded() {
    const user = await createTestUser();
    const c = await newCollection(user);
    const job = await insertJob(user.id, { provider: "google_places" });
    const results = await insertResults(job, [
      googleSpec(1, { websiteStatus: "none", websiteUrl: null, websiteHost: null }),
      googleSpec(2, { websiteStatus: "present" }),
      googleSpec(3, { websiteStatus: "unreachable" }),
      sampleSpec(4, { websiteStatus: "none", websiteUrl: null, websiteHost: null, name: "Alpha Sample", category: "Salon", city: "Accra" }),
    ]);
    await addLeads(user, c.id, { jobId: job.id, resultIds: results.map((r) => r.id) });
    const rows = await db().select().from(leads).where(eq(leads.collectionId, c.id));
    const leadFor = async (srid: string) => {
      const [b] = await db().select().from(businesses).where(eq(businesses.sourceRecordId, srid));
      return rows.find((l) => l.businessId === b!.id)!;
    };
    const l1 = await leadFor("ChIJgoogle1");
    const l2 = await leadFor("ChIJgoogle2");
    const l3 = await leadFor("ChIJgoogle3");
    const l4 = await leadFor("sample-4");
    await db().update(leads).set({ status: "won", tags: ["VIP", "Lomé"] }).where(eq(leads.id, l1.id));
    await db().update(leads).set({ status: "contacted", tags: ["Lomé"] }).where(eq(leads.id, l2.id));
    await db().update(leads).set({ status: "not_a_fit" }).where(eq(leads.id, l3.id));
    return { user, c, l1, l2, l3, l4 };
  }

  it("filters by has_website on Google rows using our own website status", async () => {
    const { user, c, l1, l4, l2, l3 } = await seeded();
    const none = await listLeads(user, c.id, "filter[has_website]=false");
    expect(none.res.status).toBe(200);
    expect(new Set(none.body.rows.map((r) => r.id))).toEqual(new Set([l1.id, l4.id]));
    const has = await listLeads(user, c.id, "filter[has_website]=true");
    expect(new Set(has.body.rows.map((r) => r.id))).toEqual(new Set([l2.id, l3.id]));
    expect(has.body.total).toBe(2);
  });

  it("sorts by lead status in workflow order and filters by status, tag and untagged", async () => {
    const { user, c, l1, l2, l3, l4 } = await seeded();
    const sorted = await listLeads(user, c.id, "sort=lead_status:asc");
    expect(sorted.body.rows.map((r) => r.id)).toEqual([l4.id, l2.id, l1.id, l3.id]); // new, contacted, won, not_a_fit
    const desc = await listLeads(user, c.id, "sort=lead_status:desc");
    expect(desc.body.rows.map((r) => r.id)).toEqual([l3.id, l1.id, l2.id, l4.id]);

    const byStatus = await listLeads(user, c.id, "filter[lead_status]=won&filter[lead_status]=contacted");
    expect(new Set(byStatus.body.rows.map((r) => r.id))).toEqual(new Set([l1.id, l2.id]));

    const byTag = await listLeads(user, c.id, "filter[tag]=VIP");
    expect(byTag.body.rows.map((r) => r.id)).toEqual([l1.id]);

    const untagged = await listLeads(user, c.id, "filter[untagged]=true");
    expect(new Set(untagged.body.rows.map((r) => r.id))).toEqual(new Set([l3.id, l4.id]));

    const searched = await listLeads(user, c.id, "search=vip");
    expect(searched.body.rows.map((r) => r.id)).toEqual([l1.id]);
  });

  it("returns facets, paging and policies for the sources present", async () => {
    const { user, c } = await seeded();
    const { body } = await listLeads(user, c.id, "page_size=25&page=1");
    expect(body.total).toBe(4);
    expect(body.pageSize).toBe(25);
    expect(body.facets.tags).toEqual([
      { value: "Lomé", count: 2 },
      { value: "VIP", count: 1 },
    ]);
    expect(body.facets.leadStatus).toEqual([
      { value: "new", count: 1 },
      { value: "contacted", count: 1 },
      { value: "won", count: 1 },
      { value: "not_a_fit", count: 1 },
    ]);
    expect(body.facets.categories).toEqual([{ value: "Salon", count: 1 }]); // Google categories are not stored
    expect(body.facets.cities).toEqual([{ value: "Accra", count: 1 }]);
    expect(body.facets.websiteStatus).toEqual(expect.arrayContaining([{ value: "none", count: 2 }, { value: "present", count: 1 }, { value: "unreachable", count: 1 }]));
    expect(body.policies.map((p) => p.source).sort()).toEqual(["google_places", "sample"]);
    const sample = body.rows.find((r: BusinessRow) => r.source === "sample")!;
    expect(sample).toMatchObject({ name: "Alpha Sample", restrictedFields: [], lead: { collectionId: c.id, status: "new", tags: [], notes: "" } });

    const page2 = await listLeads(user, c.id, "page_size=25&page=2");
    expect(page2.body.rows).toEqual([]);
    expect(page2.body.total).toBe(4);
  });

  it("rejects unknown filters with 422", async () => {
    const { user, c } = await seeded();
    expect((await listLeads(user, c.id, "filter[drop]=1")).res.status).toBe(422);
    expect((await listLeads(user, c.id, "sort=notes:asc")).res.status).toBe(422);
  });

  it("lists all matching lead ids in sort order", async () => {
    const { user, c, l1, l2 } = await seeded();
    const res = await leadIdsRoute(apiRequest(`/api/v1/collections/${c.id}/leads/ids?filter[tag]=Lomé&sort=lead_status:desc`, { user }), ctx({ id: c.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [l1.id, l2.id], total: 2, truncated: false });
  });

  it("deleting a collection removes its leads and unused business records", async () => {
    const { user, c } = await seeded();
    const res = await deleteCollectionRoute(apiRequest(`/api/v1/collections/${c.id}`, { method: "DELETE", user }), ctx({ id: c.id }));
    expect(res.status).toBe(204);
    expect(await db().select().from(leads)).toHaveLength(0);
    expect(await db().select().from(businesses)).toHaveLength(0);
  });
});
