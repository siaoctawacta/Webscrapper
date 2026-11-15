import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("disabled accounts", () => {
  it("cannot create a session", async () => {
    const u = await createTestUser();
    await db().update(user).set({ status: "disabled" }).where(eq(user.id, u.id));
    const res = await getAuth().api.signInEmail({ body: { email: u.email, password: "correct-horse-battery-staple" }, asResponse: true });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/disabled/i);
  });
});

describe("phone display", () => {
  it("shows valid numbers internationally and keeps others as provided", async () => {
    const { displayPhone } = await import("@/server/rows");
    expect(displayPhone("92 38 67 38", "+22892386738")).toBe("+228 92 38 67 38");
    expect(displayPhone("+233 24 123 4567", "+233241234567")).toBe("+233 24 123 4567");
    expect(displayPhone("12", null)).toBe("12");
    expect(displayPhone(null, null)).toBeNull();
  });
});

describe("queue options", () => {
  it("never sends undefined option keys to pg-boss", async () => {
    const { sendOptions } = await import("@/server/queue");
    expect(sendOptions({})).toEqual({ retryLimit: 0 });
    expect(Object.keys(sendOptions({ expireInSeconds: undefined, singletonKey: undefined }))).toEqual(["retryLimit"]);
    expect(sendOptions({ expireInSeconds: 60, singletonKey: "k" })).toEqual({ retryLimit: 0, expireInSeconds: 60, singletonKey: "k" });
  });

  it("enqueues an export job without options against a real pg-boss", async () => {
    const { enqueue, stopBoss } = await import("@/server/queue");
    const id = await enqueue("export.run", { exportId: "00000000-0000-0000-0000-000000000000" });
    expect(typeof id).toBe("string");
    await stopBoss();
  });
});

describe("first admin account", () => {
  const signUpWith = (email: string, setup?: string) =>
    getAuth().api.signUpEmail({
      body: { email, password: "a-long-password-1", name: "Owner" },
      headers: new Headers(setup ? { "x-setup-token": setup } : {}),
      asResponse: true,
    });
  const reset = async () => {
    const { resetEnvCache } = await import("@/server/env");
    resetEnvCache();
    delete (globalThis as { __leadfinderAuth?: unknown }).__leadfinderAuth;
  };
  afterEach(async () => {
    delete process.env.SETUP_TOKEN;
    process.env.APP_ENV = "test";
    await reset();
  });

  it("requires SETUP_TOKEN when it is configured", async () => {
    process.env.SETUP_TOKEN = "s3cret-setup-token-value";
    await reset();
    expect((await signUpWith("a@example.com")).status).toBe(403);
    expect((await signUpWith("a@example.com", "guess")).status).toBe(403);
    expect((await signUpWith("owner@example.com", "s3cret-setup-token-value")).ok).toBe(true);
    const [row] = await db().select().from(user);
    expect(row).toMatchObject({ email: "owner@example.com", role: "admin", status: "active" });
  });

  it("refuses to bootstrap in production without SETUP_TOKEN", async () => {
    process.env.APP_ENV = "production";
    await reset();
    const res = await signUpWith("a@example.com");
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/SETUP_TOKEN/);
  });
});
