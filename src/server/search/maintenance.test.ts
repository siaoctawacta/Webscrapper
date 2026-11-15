import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db";
import { businesses, jobEvents, rateLimits, searchJobs, searchResults } from "@/server/db/schema";
import { createTestUser, type TestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { runMaintenance, runMaintenanceTasks } from "./maintenance";
import { insertJob, insertResults } from "./test-fixtures";

let user: TestUser;
const NOW = new Date("2026-11-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3600 * 1000);

beforeEach(async () => {
  await resetDb();
  user = await createTestUser();
});
afterAll(closeDb);

const resultsOf = (jobId: string) => db().select().from(searchResults).where(eq(searchResults.jobId, jobId));
const jobOf = async (jobId: string) => (await db().select().from(searchJobs).where(eq(searchJobs.id, jobId)))[0]!;

describe("runMaintenanceTasks", () => {
  it("purges expired search results (source policy) and keeps the rest", async () => {
    const expired = await insertJob(user.id, { status: "completed", provider: "google_places", resultsExpireAt: hoursAgo(1) });
    const fresh = await insertJob(user.id, { status: "completed", resultsExpireAt: hoursAhead(5) });
    const alreadyPurged = await insertJob(user.id, { status: "completed", resultsExpireAt: hoursAgo(48), resultsPurgedAt: hoursAgo(47) });
    const running = await insertJob(user.id, { status: "searching", resultsExpireAt: null });
    await insertResults(expired, [{}, {}, {}]);
    await insertResults(fresh, [{}, {}]);
    await insertResults(running, [{}]);

    const report = await runMaintenanceTasks({ now: () => NOW, purgeExports: async () => 0 });
    expect(report).toMatchObject({ purgedJobs: 1, purgedResults: 3, errors: [] });
    expect(await resultsOf(expired.id)).toHaveLength(0);
    expect((await jobOf(expired.id)).resultsPurgedAt).toEqual(NOW);
    expect(await resultsOf(fresh.id)).toHaveLength(2);
    expect(await resultsOf(running.id)).toHaveLength(1);
    expect((await jobOf(alreadyPurged.id)).resultsPurgedAt).toEqual(hoursAgo(47));
    const events = await db().select().from(jobEvents).where(eq(jobEvents.jobId, expired.id));
    expect(events.map((e) => e.type)).toEqual(["results_purged"]);

    // Idempotent.
    expect((await runMaintenanceTasks({ now: () => NOW, purgeExports: async () => 0 })).purgedJobs).toBe(0);
  });

  it("expires export files through the exports cleanup", async () => {
    const purgeExports = vi.fn(async () => 2);
    const report = await runMaintenanceTasks({ now: () => NOW, purgeExports });
    expect(purgeExports).toHaveBeenCalledWith(NOW);
    expect(report.expiredExports).toBe(2);
  });

  it("forgets cached coordinates past their expiry", async () => {
    await db()
      .insert(businesses)
      .values([
        { userId: user.id, source: "google_places", sourceRecordId: "old", lat: 6.1, lng: 1.2, coordsExpireAt: hoursAgo(1) },
        { userId: user.id, source: "google_places", sourceRecordId: "new", lat: 6.3, lng: 1.4, coordsExpireAt: hoursAhead(24) },
        { userId: user.id, source: "sample", sourceRecordId: "sample", lat: 6.5, lng: 1.6, coordsExpireAt: null },
      ]);
    const report = await runMaintenanceTasks({ now: () => NOW, purgeExports: async () => 0 });
    expect(report.clearedCoordinates).toBe(1);
    const rows = Object.fromEntries((await db().select().from(businesses)).map((b) => [b.sourceRecordId, b]));
    expect(rows.old).toMatchObject({ lat: null, lng: null, coordsExpireAt: null });
    expect(rows.new).toMatchObject({ lat: 6.3, lng: 1.4 });
    expect(rows.sample).toMatchObject({ lat: 6.5, lng: 1.6 });
  });

  it("deletes rate-limit windows older than a day", async () => {
    await db()
      .insert(rateLimits)
      .values([
        { key: "old", windowStart: hoursAgo(30), count: 3 },
        { key: "recent", windowStart: hoursAgo(1), count: 3 },
      ]);
    const report = await runMaintenanceTasks({ now: () => NOW, purgeExports: async () => 0 });
    expect(report.deletedRateLimits).toBe(1);
    expect((await db().select().from(rateLimits)).map((r) => r.key)).toEqual(["recent"]);
  });

  it("fails jobs a dead worker left in an active status for more than 2 hours", async () => {
    const stuck = await insertJob(user.id, { status: "searching", updatedAt: hoursAgo(3) });
    const stuckQueued = await insertJob(user.id, { status: "queued", updatedAt: hoursAgo(5) });
    const alive = await insertJob(user.id, { status: "enriching", updatedAt: hoursAgo(1) });
    const finished = await insertJob(user.id, { status: "completed", updatedAt: hoursAgo(10) });
    const report = await runMaintenanceTasks({ now: () => NOW, purgeExports: async () => 0 });
    expect(report.failedStuckJobs).toBe(2);
    const s = await jobOf(stuck.id);
    expect(s).toMatchObject({ status: "failed", finishedAt: NOW });
    expect(s.error).toMatch(/^The worker stopped unexpectedly/);
    expect(s.resultsExpireAt).not.toBeNull();
    expect((await jobOf(stuckQueued.id)).status).toBe("failed");
    expect((await jobOf(alive.id)).status).toBe("enriching");
    expect((await jobOf(finished.id)).status).toBe("completed");
  });

  it("keeps going when one task fails", async () => {
    const expired = await insertJob(user.id, { status: "completed", resultsExpireAt: hoursAgo(1) });
    await insertResults(expired, [{}]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = await runMaintenanceTasks({
      now: () => NOW,
      purgeExports: async () => {
        throw new Error("disk unavailable");
      },
    });
    errorSpy.mockRestore();
    expect(report.errors).toEqual(["purge exports: disk unavailable"]);
    expect(report.purgedJobs).toBe(1);
  });

  it("runs with the defaults (worker entry point)", async () => {
    await expect(runMaintenance()).resolves.toBeUndefined();
  });
});
