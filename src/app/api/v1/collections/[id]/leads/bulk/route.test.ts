import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { ApiError } from "@/lib/api-types";
import type { LeadStatus } from "@/lib/domain";
import { closeDb, db } from "@/server/db";
import { auditLogs, businesses, leads, type Lead } from "@/server/db/schema";
import type { AppUser } from "@/server/auth/session";
import { addToCollection, createCollection } from "@/server/collections";
import { apiRequest, createTestUser, ctx, googleSpec, insertJob, insertResults, resetDb, sampleSpec, type TestUser } from "@/server/collections/test-fixtures";
import { POST } from "./route";

beforeEach(resetDb);
afterAll(closeDb);

const appUser = (u: TestUser): AppUser => ({ id: u.id, email: u.email, name: "Test", role: "member", status: "active" });

async function seed(n = 4) {
  const user = await createTestUser();
  const u = appUser(user);
  const source = await createCollection(u, { name: "Source" });
  const target = await createCollection(u, { name: "Target" });
  const job = await insertJob(user.id);
  const results = await insertResults(
    job,
    Array.from({ length: n }, (_, i) => (i % 2 ? sampleSpec(i + 1) : googleSpec(i + 1, { websiteStatus: i === 0 ? "none" : "present" }))),
  );
  await addToCollection(u, source.id, { jobId: job.id, resultIds: results.map((r) => r.id) });
  const rows = await db().select().from(leads).where(eq(leads.collectionId, source.id)).orderBy(leads.createdAt);
  return { user, u, source, target, job, results, leads: rows.reverse() }; // in display order (newest first)
}

const bulk = (user: TestUser, collectionId: string, body: unknown) =>
  POST(apiRequest(`/api/v1/collections/${collectionId}/leads/bulk`, { method: "POST", body, user }), ctx({ id: collectionId }));

const leadsIn = (collectionId: string) => db().select().from(leads).where(eq(leads.collectionId, collectionId));
const byId = async (id: string): Promise<Lead> => (await db().select().from(leads).where(eq(leads.id, id)))[0]!;

describe("bulk lead actions", () => {
  it("set_status updates only selected leads of this collection and stamps last contacted", async () => {
    const { user, source, leads: ls } = await seed();
    const outsider = await seed(1); // another user's lead id in the payload is ignored
    const res = await bulk(user, source.id, { leadIds: [ls[0]!.id, ls[1]!.id, outsider.leads[0]!.id], action: "set_status", status: "contacted" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affected: 2 });
    expect((await byId(ls[0]!.id)).status).toBe("contacted");
    expect((await byId(ls[0]!.id)).lastContactedAt).not.toBeNull();
    expect((await byId(ls[2]!.id)).status).toBe("new");
    expect((await byId(outsider.leads[0]!.id)).status).toBe("new");

    const won = await bulk(user, source.id, { leadIds: [ls[2]!.id], action: "set_status", status: "won" });
    expect(await won.json()).toEqual({ affected: 1 });
    expect((await byId(ls[2]!.id)).lastContactedAt).toBeNull();

    const [a] = await db().select().from(auditLogs).where(eq(auditLogs.action, "collection.bulk"));
    expect(a!.metadata).toMatchObject({ action: "set_status", selector: "ids", requested: 3, affected: 2, status: "contacted" });
  });

  it("add_tags merges case-insensitively, keeps existing casing and order, caps at 30", async () => {
    const { user, source, leads: ls } = await seed();
    await db().update(leads).set({ tags: ["VIP", "Lomé"] }).where(eq(leads.id, ls[0]!.id));
    const filler = Array.from({ length: 29 }, (_, i) => `t${i}`);
    await db().update(leads).set({ tags: filler }).where(eq(leads.id, ls[1]!.id));

    const res = await bulk(user, source.id, { leadIds: [ls[0]!.id, ls[1]!.id], action: "add_tags", tags: ["vip", " Hot   lead ", "LOMÉ", "New"] });
    expect(await res.json()).toEqual({ affected: 2 });
    expect((await byId(ls[0]!.id)).tags).toEqual(["VIP", "Lomé", "Hot lead", "New"]);
    expect((await byId(ls[1]!.id)).tags).toEqual([...filler, "vip"]);

    const tooLong = await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "add_tags", tags: ["y".repeat(41)] });
    expect(tooLong.status).toBe(422);
    const empty = await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "add_tags", tags: ["  "] });
    expect(empty.status).toBe(422);
  });

  it("remove_tags removes case-insensitively; replace_tags replaces (or clears)", async () => {
    const { user, source, leads: ls } = await seed();
    await db().update(leads).set({ tags: ["VIP", "Lomé", "Hot lead"] }).where(eq(leads.id, ls[0]!.id));
    await db().update(leads).set({ tags: ["vip"] }).where(eq(leads.id, ls[1]!.id));

    expect(await (await bulk(user, source.id, { leadIds: [ls[0]!.id, ls[1]!.id], action: "remove_tags", tags: ["vip", "hot  LEAD"] })).json()).toEqual({ affected: 2 });
    expect((await byId(ls[0]!.id)).tags).toEqual(["Lomé"]);
    expect((await byId(ls[1]!.id)).tags).toEqual([]);

    await bulk(user, source.id, { leadIds: [ls[0]!.id, ls[2]!.id], action: "replace_tags", tags: ["Accra", "accra", "Follow up"] });
    expect((await byId(ls[0]!.id)).tags).toEqual(["Accra", "Follow up"]);
    expect((await byId(ls[2]!.id)).tags).toEqual(["Accra", "Follow up"]);

    await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "replace_tags", tags: [] });
    expect((await byId(ls[0]!.id)).tags).toEqual([]);
  });

  it("selects by query (filters on business and lead columns)", async () => {
    const { user, source, leads: ls } = await seed();
    await db().update(leads).set({ tags: ["VIP"] }).where(eq(leads.id, ls[3]!.id));
    // has_website=false matches only the first Google row (website_status none).
    const res = await bulk(user, source.id, { query: { filters: { has_website: false } }, action: "set_status", status: "qualified" });
    expect(await res.json()).toEqual({ affected: 1 });
    const qualified = (await leadsIn(source.id)).filter((l) => l.status === ("qualified" as LeadStatus));
    expect(qualified).toHaveLength(1);

    const tagged = await bulk(user, source.id, { query: { filters: { untagged: true } }, action: "add_tags", tags: ["Batch 1"] });
    expect(await tagged.json()).toEqual({ affected: 3 });
    expect((await byId(ls[3]!.id)).tags).toEqual(["VIP"]);

    const bad = await bulk(user, source.id, { query: { filters: { nope: true } }, action: "remove" });
    expect(bad.status).toBe(422);
  });

  it("copy_to keeps annotations and skips leads already in the target", async () => {
    const { user, u, source, target, job, results, leads: ls } = await seed();
    await db().update(leads).set({ status: "replied", tags: ["VIP"], notes: "Call back", lastContactedAt: new Date("2026-11-01T00:00:00Z") }).where(eq(leads.id, ls[0]!.id));
    // One business already in the target.
    const alreadyResult = results.find((r) => r.sourceRecordId === "sample-2")!;
    await addToCollection(u, target.id, { jobId: job.id, resultIds: [alreadyResult.id] });

    const res = await bulk(user, source.id, { leadIds: ls.map((l) => l.id), action: "copy_to", targetCollectionId: target.id });
    expect(await res.json()).toEqual({ affected: 3, skipped: 1 });
    expect(await leadsIn(source.id)).toHaveLength(4);
    const tgt = await leadsIn(target.id);
    expect(tgt).toHaveLength(4);
    const copied = tgt.find((l) => l.businessId === ls[0]!.businessId)!;
    expect(copied).toMatchObject({ status: "replied", tags: ["VIP"], notes: "Call back", userId: user.id });
    expect(copied.lastContactedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(copied.id).not.toBe(ls[0]!.id);
    // Business records are shared, not duplicated.
    expect(await db().select().from(businesses)).toHaveLength(4);
  });

  it("move_to moves copied and already-present leads, leaving the rest", async () => {
    const { user, u, source, target, job, results, leads: ls } = await seed();
    const alreadyResult = results.find((r) => r.sourceRecordId === "sample-2")!;
    await addToCollection(u, target.id, { jobId: job.id, resultIds: [alreadyResult.id] });
    const alreadyLead = ls.find((l) => l.businessId === (async () => null, l.businessId) && false);
    void alreadyLead;

    const selected = ls.slice(0, 3).map((l) => l.id);
    const res = await bulk(user, source.id, { leadIds: selected, action: "move_to", targetCollectionId: target.id });
    const body = (await res.json()) as { affected: number; skipped: number };
    const sourceAfter = await leadsIn(source.id);
    const targetAfter = await leadsIn(target.id);
    expect(sourceAfter.map((l) => l.id)).toEqual([ls[3]!.id]);
    const selectedBusinesses = new Set(ls.slice(0, 3).map((l) => l.businessId));
    const alreadyWasSelected = selectedBusinesses.has(
      (await db().select().from(businesses).where(eq(businesses.sourceRecordId, "sample-2")))[0]!.id,
    );
    expect(body.affected).toBe(3);
    expect(body.skipped).toBe(alreadyWasSelected ? 1 : 0);
    expect(targetAfter).toHaveLength(alreadyWasSelected ? 3 : 4);
    expect(await db().select().from(businesses)).toHaveLength(4);
  });

  it("copy/move require another collection owned by the user", async () => {
    const { user, source, leads: ls } = await seed();
    const other = await seed(1);
    const same = await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "move_to", targetCollectionId: source.id });
    expect(same.status).toBe(422);
    const foreign = await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "copy_to", targetCollectionId: other.target.id });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as ApiError).error.message).toBe("Collection not found");
    const missing = await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "copy_to" });
    expect(missing.status).toBe(422);
    expect(await leadsIn(source.id)).toHaveLength(4);
  });

  it("remove deletes selected leads and orphaned business records only", async () => {
    const { user, u, source, target, job, results, leads: ls } = await seed();
    // Lead 0's business is also in the target, so its record must survive.
    const shared = results.find((r) => r.sourceRecordId === "ChIJgoogle1")!;
    await addToCollection(u, target.id, { jobId: job.id, resultIds: [shared.id] });
    const res = await bulk(user, source.id, { leadIds: ls.map((l) => l.id), action: "remove" });
    expect(await res.json()).toEqual({ affected: 4 });
    expect(await leadsIn(source.id)).toHaveLength(0);
    const left = await db().select().from(businesses);
    expect(left.map((b) => b.sourceRecordId)).toEqual(["ChIJgoogle1"]);
  });

  it("is scoped to the owner: another user's collection is 404", async () => {
    const { source, leads: ls } = await seed();
    const intruder = await createTestUser();
    const res = await bulk(intruder, source.id, { leadIds: [ls[0]!.id], action: "remove" });
    expect(res.status).toBe(404);
    expect(await leadsIn(source.id)).toHaveLength(4);
  });

  it("validates the body", async () => {
    const { user, source, leads: ls } = await seed();
    expect((await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "explode" })).status).toBe(422);
    expect((await bulk(user, source.id, { leadIds: [ls[0]!.id], action: "set_status" })).status).toBe(422);
    expect((await bulk(user, source.id, { action: "remove" })).status).toBe(422);
    expect((await bulk(user, source.id, { leadIds: [ls[0]!.id], query: {}, action: "remove" })).status).toBe(422);
    expect((await bulk(user, source.id, { leadIds: ["not-a-uuid"], action: "remove" })).status).toBe(422);
    const rows = await db().select().from(leads).where(and(eq(leads.collectionId, source.id), eq(leads.status, "new")));
    expect(rows).toHaveLength(4);
  });
});
