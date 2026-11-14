import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ApiError, BusinessRow } from "@/lib/api-types";
import { closeDb, db } from "@/server/db";
import { auditLogs, businesses, leads } from "@/server/db/schema";
import { addToCollection, createCollection } from "@/server/collections";
import { apiRequest, createTestUser, ctx, googleSpec, insertJob, insertResults, resetDb, sampleSpec, type TestUser } from "@/server/collections/test-fixtures";
import type { AppUser } from "@/server/auth/session";
import { DELETE, PATCH } from "./route";

beforeEach(resetDb);
afterAll(closeDb);

const appUser = (u: TestUser): AppUser => ({ id: u.id, email: u.email, name: "Test", role: "member", status: "active" });

async function seed() {
  const user = await createTestUser();
  const c = await createCollection(appUser(user), { name: "Leads" });
  const job = await insertJob(user.id);
  const results = await insertResults(job, [googleSpec(1), sampleSpec(2)]);
  await addToCollection(appUser(user), c.id, { jobId: job.id, resultIds: results.map((r) => r.id) });
  const rows = await db().select().from(leads).where(eq(leads.collectionId, c.id));
  return { user, collection: c, leadIds: rows.map((r) => r.id) };
}

const patch = (user: TestUser, id: string, body: unknown) =>
  PATCH(apiRequest(`/api/v1/leads/${id}`, { method: "PATCH", body, user }), ctx({ id }));

describe("PATCH /api/v1/leads/{id}", () => {
  it("updates status, tags and notes and returns the row", async () => {
    const { user, leadIds } = await seed();
    const id = leadIds[0]!;
    const res = await patch(user, id, { status: "qualified", tags: ["  Hot   lead ", "hot lead", "Lomé", ""], notes: "Called on Monday." });
    expect(res.status).toBe(200);
    const row = (await res.json()) as BusinessRow;
    expect(row.id).toBe(id);
    expect(row.lead).toMatchObject({ status: "qualified", tags: ["Hot lead", "Lomé"], notes: "Called on Monday.", lastContactedAt: null });

    const [audit] = await db().select().from(auditLogs).where(eq(auditLogs.action, "lead.update"));
    expect(audit).toMatchObject({ resourceId: id, actorId: user.id });
    expect(audit!.metadata).toMatchObject({ fields: ["status", "tags", "notes"], status: "qualified" });
  });

  it("stamps last_contacted_at when the status becomes contacted or proposal_sent", async () => {
    const { user, leadIds } = await seed();
    const before = Date.now();
    const row = (await (await patch(user, leadIds[0]!, { status: "contacted" })).json()) as BusinessRow;
    expect(row.lead!.lastContactedAt).not.toBeNull();
    expect(new Date(row.lead!.lastContactedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const row2 = (await (await patch(user, leadIds[1]!, { status: "proposal_sent" })).json()) as BusinessRow;
    expect(row2.lead!.lastContactedAt).not.toBeNull();

    // Other statuses keep the previous date.
    const row3 = (await (await patch(user, leadIds[0]!, { status: "replied" })).json()) as BusinessRow;
    expect(row3.lead!.lastContactedAt).toBe(row.lead!.lastContactedAt);
  });

  it("validates tags and notes with plain messages", async () => {
    const { user, leadIds } = await seed();
    const long = await patch(user, leadIds[0]!, { tags: ["x".repeat(41)] });
    expect(long.status).toBe(422);
    expect(((await long.json()) as ApiError).error.message).toMatch(/at most 40 characters/);

    const many = await patch(user, leadIds[0]!, { tags: Array.from({ length: 31 }, (_, i) => `tag ${i}`) });
    expect(many.status).toBe(422);
    expect(((await many.json()) as ApiError).error.message).toMatch(/at most 30 tags/);

    expect((await patch(user, leadIds[0]!, { notes: "n".repeat(10_001) })).status).toBe(422);
    expect((await patch(user, leadIds[0]!, { notes: "n".repeat(10_000) })).status).toBe(200);
    expect((await patch(user, leadIds[0]!, { status: "maybe" })).status).toBe(422);
  });

  it("does not let another user touch the lead", async () => {
    const { leadIds } = await seed();
    const intruder = await createTestUser();
    expect((await patch(intruder, leadIds[0]!, { status: "won" })).status).toBe(404);
    expect((await DELETE(apiRequest(`/api/v1/leads/${leadIds[0]}`, { method: "DELETE", user: intruder }), ctx({ id: leadIds[0]! }))).status).toBe(404);
    expect((await patch(intruder, "nope", { status: "won" })).status).toBe(404);
    const [l] = await db().select().from(leads).where(eq(leads.id, leadIds[0]!));
    expect(l!.status).toBe("new");
  });
});

describe("DELETE /api/v1/leads/{id}", () => {
  it("removes the lead and its now-unused business record", async () => {
    const { user, leadIds } = await seed();
    const id = leadIds[0]!;
    const res = await DELETE(apiRequest(`/api/v1/leads/${id}`, { method: "DELETE", user }), ctx({ id }));
    expect(res.status).toBe(204);
    expect(await db().select().from(leads)).toHaveLength(1);
    expect(await db().select().from(businesses)).toHaveLength(1);
    const again = await DELETE(apiRequest(`/api/v1/leads/${id}`, { method: "DELETE", user }), ctx({ id }));
    expect(again.status).toBe(404);
    expect((await db().select().from(auditLogs).where(eq(auditLogs.action, "lead.remove"))).length).toBe(1);
  });
});
