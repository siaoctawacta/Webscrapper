import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/domain";
import { db } from "../db";
import { searchJobs } from "../db/schema";
import { env } from "../env";
import { HttpError } from "../errors";
import { getUserLimitOverrides } from "../settings";
import { concurrentLimitMessage, dailyLimitMessage, effectiveMaxResults, effectiveMonthlyLimit } from "./limits";

export type UserSearchLimits = {
  maxResultsPerSearch: number;
  /** Billable provider requests per calendar month (UTC). 0 = unlimited. */
  monthlyRequestLimit: number;
  /** Searches running at the same time. 0 = unlimited. */
  maxConcurrentJobs: number;
  /** Searches started in any 24 h window. 0 = unlimited. */
  maxJobsPerDay: number;
};

export async function getUserSearchLimits(userId: string): Promise<UserSearchLimits> {
  const e = env();
  const overrides = await getUserLimitOverrides(userId);
  return {
    maxResultsPerSearch: effectiveMaxResults(overrides.maxResultsPerSearch, e.MAX_RESULTS_PER_SEARCH),
    monthlyRequestLimit: effectiveMonthlyLimit(overrides.monthlyRequestLimit, e.MONTHLY_PROVIDER_REQUEST_LIMIT_PER_USER),
    maxConcurrentJobs: Math.max(0, Math.floor(e.MAX_CONCURRENT_JOBS_PER_USER)),
    maxJobsPerDay: Math.max(0, Math.floor(e.MAX_SEARCH_JOBS_PER_USER_PER_DAY)),
  };
}

/** Throws HttpError("quota_exceeded") when the user has too many running searches or too many today. */
export async function assertJobSlots(userId: string, limits: UserSearchLimits, now: Date = new Date()): Promise<void> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const [row] = await db()
    .select({
      active: sql<number>`count(*) filter (where ${inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])})::int`,
      today: sql<number>`count(*) filter (where ${gte(searchJobs.createdAt, since)})::int`,
    })
    .from(searchJobs)
    .where(and(eq(searchJobs.userId, userId)));
  const active = row?.active ?? 0;
  const today = row?.today ?? 0;
  if (limits.maxConcurrentJobs > 0 && active >= limits.maxConcurrentJobs) {
    throw new HttpError("quota_exceeded", concurrentLimitMessage(limits.maxConcurrentJobs), { limit: "concurrent_jobs", max: limits.maxConcurrentJobs });
  }
  if (limits.maxJobsPerDay > 0 && today >= limits.maxJobsPerDay) {
    throw new HttpError("quota_exceeded", dailyLimitMessage(limits.maxJobsPerDay), { limit: "jobs_per_day", max: limits.maxJobsPerDay });
  }
}
