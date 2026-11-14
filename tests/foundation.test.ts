import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/server/db";
import { searchJobs, searchResults, user } from "@/server/db/schema";
import { requireActiveUser, requireAdminUser } from "@/server/auth/session";
import { buildFilterConditions, buildOrderBy, RESULTS_GRID } from "@/server/db/list-sql";
import { parseListQuery } from "@/lib/list-query";
import { emptyProgress } from "@/lib/domain";
import { resetDb } from "./helpers/db";
import { createTestUser } from "./helpers/auth";
import { getAuth } from "@/server/auth/auth";

beforeEach(resetDb);
afterAll(closeDb);

describe("auth bootstrap", () => {
  it("makes the first account an active admin and later ones pending", async () => {
    const r1 = await getAuth().api.signUpEmail({ body: { email: "Owner@Example.com", password: "a-long-password-1", name: "Owner" }, asResponse: true });
    expect(r1.ok).toBe(true);
    const r2 = await getAuth().api.signUpEmail({ body: { email: "second@example.com", password: "a-long-password-2", name: "Second" }, asResponse: true });
    expect(r2.ok).toBe(true);
    const rows = await db().select().from(user).orderBy(user.createdAt);
    expect(rows.map((r) => [r.email, r.role, r.status])).toEqual([
      ["owner@example.com", "admin", "active"],
      ["second@example.com", "member", "pending"],
    ]);
  });

  it("guards reject pending users and non-admins", async () => {
    const admin = await createTestUser({ role: "admin" });
    const pending = await createTestUser({ status: "pending" });
    const member = await createTestUser();
    await expect(requireAdminUser(admin.headers)).resolves.toMatchObject({ role: "admin" });
    await expect(requireActiveUser(pending.headers)).rejects.toMatchObject({ code: "forbidden" });
    await expect(requireAdminUser(member.headers)).rejects.toMatchObject({ code: "forbidden" });
    await expect(requireActiveUser(new Headers())).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("list SQL", () => {
  it("filters with array params and sorts with nulls last", async () => {
    const u = await createTestUser();
    const [job] = await db()
      .insert(searchJobs)
      .values({ userId: u.id, kind: "keyword", query: "hotel", location: { label: "Lomé" }, provider: "sample", targetCount: 20, progress: emptyProgress() })
      .returning();
    const mk = (i: number, name: string | null, category: string | null, rating: number | null) => ({
      jobId: job!.id, userId: u.id, position: i, source: "sample" as const, sourceRecordId: `s${i}`, name, category, rating,
      websiteStatus: (i % 2 ? "none" : "present") as "none" | "present",
    });
    await db().insert(searchResults).values([mk(1, "beta", "Hotel", 4.1), mk(2, "Alpha", "Hotel", null), mk(3, "gamma", "Lodge", 3.9), mk(4, null, "Hotel", 4.8)]);
    const q = parseListQuery(new URLSearchParams("sort=rating:desc&filter[category]=Hotel&filter[category]=Guest house"), "results");
    const where = and(eq(searchResults.jobId, job!.id), ...buildFilterConditions(q.filters, q.search, RESULTS_GRID));
    const rows = await db().select({ name: searchResults.name, rating: searchResults.rating }).from(searchResults).where(where).orderBy(...buildOrderBy(q, RESULTS_GRID));
    expect(rows.map((r) => r.rating)).toEqual([4.8, 4.1, null]);

    const q2 = parseListQuery(new URLSearchParams("sort=business_name:asc&filter[has_website]=false&search=a"), "results");
    const rows2 = await db().select({ name: searchResults.name }).from(searchResults)
      .where(and(eq(searchResults.jobId, job!.id), ...buildFilterConditions(q2.filters, q2.search, RESULTS_GRID)))
      .orderBy(...buildOrderBy(q2, RESULTS_GRID));
    expect(rows2.map((r) => r.name)).toEqual(["beta", "gamma"]);
    expect((await db().execute(sql`select 1 as x`)).rows[0]).toEqual({ x: 1 });
  });

  it("rejects unknown sort fields and filters", () => {
    expect(() => parseListQuery(new URLSearchParams("sort=password:asc"), "results")).toThrow(/Cannot sort/);
    expect(() => parseListQuery(new URLSearchParams("filter[drop_table]=1"), "results")).toThrow(/Unknown filter/);
    expect(() => parseListQuery(new URLSearchParams("filter[lead_status]=new"), "results")).toThrow(/not available/);
    expect(() => parseListQuery(new URLSearchParams("page_size=1000"), "results")).toThrow(/page_size/);
  });
});
