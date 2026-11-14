import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { SearchJobDto } from "@/lib/api-types";
import { ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES } from "@/lib/domain";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { jobEvents, searchJobs, searchResults, type SearchJob } from "../db/schema";
import { HttpError } from "../errors";
import { getPolicy } from "../providers/policy";
import { emptyCounts, toSearchJobDto, type JobCounts } from "./dto";
import { getOwnedJob } from "./results";

type UserRef = Pick<AppUser, "id">;
type RequestMeta = { ip?: string | null };

export const JOBS_PAGE_SIZE = 20;
export const CANCELLED_BEFORE_START = "Stopped before it started.";

/** Result counts for several jobs in one aggregate query (ownership included). */
export async function countsForJobs(user: UserRef, jobIds: string[]): Promise<Map<string, JobCounts>> {
  const out = new Map<string, JobCounts>();
  if (jobIds.length === 0) return out;
  const rows = await db()
    .select({
      jobId: searchResults.jobId,
      total: sql<number>`count(*)::int`,
      withWebsite: sql<number>`count(*) filter (where ${searchResults.websiteStatus} <> 'none')::int`,
      withoutWebsite: sql<number>`count(*) filter (where ${searchResults.websiteStatus} = 'none')::int`,
      withEmail: sql<number>`count(*) filter (where ${searchResults.primaryEmail} is not null)::int`,
      withPhone: sql<number>`count(*) filter (where ${searchResults.phoneE164} is not null or ${searchResults.phoneRaw} is not null)::int`,
    })
    .from(searchResults)
    .where(and(eq(searchResults.userId, user.id), sql`${searchResults.jobId} = any(${sql.param(jobIds)}::uuid[])`))
    .groupBy(searchResults.jobId);
  for (const r of rows) {
    out.set(r.jobId, {
      total: Number(r.total),
      withWebsite: Number(r.withWebsite),
      withoutWebsite: Number(r.withoutWebsite),
      withEmail: Number(r.withEmail),
      withPhone: Number(r.withPhone),
    });
  }
  return out;
}

export async function jobDtoWithCounts(user: UserRef, job: SearchJob): Promise<SearchJobDto> {
  const counts = await countsForJobs(user, [job.id]);
  return toSearchJobDto(job, counts.get(job.id) ?? emptyCounts());
}

/** GET /search-jobs/{id} */
export async function getSearchJob(user: AppUser, jobId: string): Promise<SearchJobDto> {
  return jobDtoWithCounts(user, await getOwnedJob(user, jobId));
}

/** GET /search-jobs?page — newest first, 20 per page. */
export async function listSearchJobs(user: AppUser, page = 1): Promise<{ jobs: SearchJobDto[]; total: number; page: number; pageSize: number }> {
  const where = eq(searchJobs.userId, user.id);
  const [totalRow, jobs] = await Promise.all([
    db().select({ n: count() }).from(searchJobs).where(where),
    db()
      .select()
      .from(searchJobs)
      .where(where)
      .orderBy(desc(searchJobs.createdAt), desc(searchJobs.id))
      .limit(JOBS_PAGE_SIZE)
      .offset((page - 1) * JOBS_PAGE_SIZE),
  ]);
  const counts = await countsForJobs(
    user,
    jobs.map((j) => j.id),
  );
  return {
    jobs: jobs.map((j) => toSearchJobDto(j, counts.get(j.id) ?? emptyCounts())),
    total: Number(totalRow[0]?.n ?? 0),
    page,
    pageSize: JOBS_PAGE_SIZE,
  };
}

export function parseJobsPage(raw: string | null): number {
  if (raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new HttpError("validation_failed", "page must be a positive whole number.");
  return n;
}

export const resultsExpiry = (job: Pick<SearchJob, "provider">, now: Date) =>
  new Date(now.getTime() + getPolicy(job.provider).transientRetentionHours * 3600 * 1000);

/**
 * POST /search-jobs/{id}/cancel. A queued job is cancelled at once; a running one is asked to stop
 * (the runner checks the flag and keeps what it found). Finished jobs are returned unchanged.
 */
export async function cancelSearchJob(user: AppUser, jobId: string, meta: RequestMeta = {}): Promise<SearchJobDto> {
  const job = await getOwnedJob(user, jobId);
  if (TERMINAL_JOB_STATUSES.includes(job.status)) return jobDtoWithCounts(user, job);

  const now = new Date();
  const owned = and(eq(searchJobs.id, job.id), eq(searchJobs.userId, user.id));
  const [stoppedNow] = await db()
    .update(searchJobs)
    .set({
      status: "cancelled",
      cancelRequested: true,
      stopReason: CANCELLED_BEFORE_START,
      finishedAt: now,
      resultsExpireAt: resultsExpiry(job, now),
      progress: { ...job.progress, phase: "done", message: CANCELLED_BEFORE_START },
    })
    .where(and(owned, eq(searchJobs.status, "queued")))
    .returning();

  let updated = stoppedNow;
  if (!updated) {
    // Already picked up by a worker: ask it to stop.
    [updated] = await db()
      .update(searchJobs)
      .set({ cancelRequested: true })
      .where(and(owned, inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])))
      .returning();
  }
  await db()
    .insert(jobEvents)
    .values({
      jobId: job.id,
      type: stoppedNow ? "cancelled" : "cancel_requested",
      message: stoppedNow ? CANCELLED_BEFORE_START : "Stop requested — finishing the current step and keeping the results found so far.",
    });
  await audit({
    actorId: user.id,
    action: "search.cancel",
    resourceType: "search_job",
    resourceId: job.id,
    metadata: { statusBefore: job.status, immediate: Boolean(stoppedNow) },
    ip: meta.ip,
  });
  return jobDtoWithCounts(user, updated ?? (await getOwnedJob(user, job.id)));
}

/** DELETE /search-jobs/{id}: removes the job, its results and events. A running job is told to stop first. */
export async function deleteSearchJob(user: AppUser, jobId: string, meta: RequestMeta = {}): Promise<void> {
  const job = await getOwnedJob(user, jobId);
  const owned = and(eq(searchJobs.id, job.id), eq(searchJobs.userId, user.id));
  if (ACTIVE_JOB_STATUSES.includes(job.status)) {
    await db().update(searchJobs).set({ cancelRequested: true }).where(owned);
  }
  const [counted] = await db()
    .select({ n: count() })
    .from(searchResults)
    .where(and(eq(searchResults.jobId, job.id), eq(searchResults.userId, user.id)));
  await db().delete(searchJobs).where(owned);
  await audit({
    actorId: user.id,
    action: "search.delete",
    resourceType: "search_job",
    resourceId: job.id,
    metadata: { query: job.query, status: job.status, results: Number(counted?.n ?? 0) },
    ip: meta.ip,
  });
}
