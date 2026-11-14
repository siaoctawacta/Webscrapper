import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/domain";
import { db } from "../db";
import { businesses, jobEvents, rateLimits, searchJobs, searchResults } from "../db/schema";
import { purgeExpiredExports } from "../exports/cleanup";
import { resultsExpiry } from "./jobs";
import { STOP_MESSAGES } from "./runner-helpers";

/** Jobs in an active status with no update for this long are considered abandoned by a crashed worker. */
export const STUCK_JOB_AFTER_MS = 2 * 3600 * 1000;
/** Rate-limit windows older than this are deleted. */
export const RATE_LIMIT_RETENTION_MS = 24 * 3600 * 1000;
const PURGE_BATCH = 100;

export type MaintenanceReport = {
  purgedJobs: number;
  purgedResults: number;
  expiredExports: number;
  clearedCoordinates: number;
  deletedRateLimits: number;
  failedStuckJobs: number;
  errors: string[];
};

export type MaintenanceDeps = {
  now?: () => Date;
  purgeExports?: (now: Date) => Promise<number>;
};

/** Delete the result rows of finished jobs whose retention window has passed (source policy). */
export async function purgeExpiredResults(now: Date): Promise<{ jobs: number; results: number }> {
  let jobs = 0;
  let results = 0;
  for (;;) {
    const expired = await db()
      .select({ id: searchJobs.id })
      .from(searchJobs)
      .where(and(isNotNull(searchJobs.resultsExpireAt), lt(searchJobs.resultsExpireAt, now), isNull(searchJobs.resultsPurgedAt)))
      .limit(PURGE_BATCH);
    if (expired.length === 0) break;
    for (const { id } of expired) {
      const deleted = await db().transaction(async (tx) => {
        const del = await tx.delete(searchResults).where(eq(searchResults.jobId, id)).returning({ id: searchResults.id });
        await tx.update(searchJobs).set({ resultsPurgedAt: now }).where(eq(searchJobs.id, id));
        await tx.insert(jobEvents).values({
          jobId: id,
          type: "results_purged",
          message: `Results deleted after the retention period (${del.length}).`,
          metadata: { results: del.length },
        });
        return del.length;
      });
      jobs += 1;
      results += deleted;
    }
    if (expired.length < PURGE_BATCH) break;
  }
  return { jobs, results };
}

/** Google allows caching coordinates for a limited time only: forget them on expiry. */
export async function clearExpiredCoordinates(now: Date): Promise<number> {
  const rows = await db()
    .update(businesses)
    .set({ lat: null, lng: null, coordsExpireAt: null })
    .where(and(isNotNull(businesses.coordsExpireAt), lt(businesses.coordsExpireAt, now)))
    .returning({ id: businesses.id });
  return rows.length;
}

export async function pruneRateLimits(now: Date): Promise<number> {
  const rows = await db()
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - RATE_LIMIT_RETENTION_MS)))
    .returning({ key: rateLimits.key });
  return rows.length;
}

/** Jobs left in an active status by a worker that died: mark them failed so the user is told. */
export async function failStuckJobs(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_JOB_AFTER_MS);
  const stuck = await db()
    .select({ id: searchJobs.id, provider: searchJobs.provider, progress: searchJobs.progress })
    .from(searchJobs)
    .where(and(inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES]), lt(searchJobs.updatedAt, cutoff)));
  let n = 0;
  const message = STOP_MESSAGES.workerStopped();
  for (const job of stuck) {
    const [row] = await db()
      .update(searchJobs)
      .set({
        status: "failed",
        error: message,
        finishedAt: now,
        resultsExpireAt: resultsExpiry(job, now),
        progress: { ...job.progress, phase: "done", message },
      })
      // Re-check inside the update so a job that just woke up is not touched.
      .where(and(eq(searchJobs.id, job.id), inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES]), lt(searchJobs.updatedAt, cutoff)))
      .returning({ id: searchJobs.id });
    if (row) {
      n += 1;
      await db().insert(jobEvents).values({ jobId: job.id, type: "failed", message });
    }
  }
  return n;
}

/** Run every maintenance task; one failing task does not stop the others. */
export async function runMaintenanceTasks(deps: MaintenanceDeps = {}): Promise<MaintenanceReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report: MaintenanceReport = {
    purgedJobs: 0,
    purgedResults: 0,
    expiredExports: 0,
    clearedCoordinates: 0,
    deletedRateLimits: 0,
    failedStuckJobs: 0,
    errors: [],
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[maintenance] ${name} failed`, e);
      report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await step("purge results", async () => {
    const r = await purgeExpiredResults(now);
    report.purgedJobs = r.jobs;
    report.purgedResults = r.results;
  });
  await step("purge exports", async () => {
    report.expiredExports = await (deps.purgeExports ?? purgeExpiredExports)(now);
  });
  await step("expire coordinates", async () => {
    report.clearedCoordinates = await clearExpiredCoordinates(now);
  });
  await step("prune rate limits", async () => {
    report.deletedRateLimits = await pruneRateLimits(now);
  });
  await step("fail stuck jobs", async () => {
    report.failedStuckJobs = await failStuckJobs(now);
  });
  return report;
}

/** Periodic cleanup: purge expired results/exports, expire cached coordinates, prune rate limits. */
export async function runMaintenance(deps: MaintenanceDeps = {}): Promise<void> {
  const r = await runMaintenanceTasks(deps);
  const changed = r.purgedJobs + r.expiredExports + r.clearedCoordinates + r.deletedRateLimits + r.failedStuckJobs;
  if (changed > 0 || r.errors.length > 0) {
    console.log(
      `[maintenance] purged ${r.purgedResults} results from ${r.purgedJobs} searches, ${r.expiredExports} exports expired, ` +
        `${r.clearedCoordinates} coordinates cleared, ${r.deletedRateLimits} rate-limit rows removed, ${r.failedStuckJobs} stuck searches failed` +
        (r.errors.length ? `; errors: ${r.errors.join("; ")}` : ""),
    );
  }
}
