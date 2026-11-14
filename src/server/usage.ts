import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, type DbOrTx } from "./db";
import { usageLogs } from "./db/schema";

export type UsageEntry = {
  userId: string | null;
  provider: string;
  operation: string;
  requestCount?: number;
  billable: boolean;
  estimatedCostUsd?: number;
  jobId?: string | null;
};

export async function recordUsage(u: UsageEntry, tx?: DbOrTx) {
  await (tx ?? db()).insert(usageLogs).values({
    userId: u.userId,
    provider: u.provider,
    operation: u.operation,
    requestCount: u.requestCount ?? 1,
    billable: u.billable,
    estimatedCostUsd: u.estimatedCostUsd ?? 0,
    jobId: u.jobId ?? null,
  });
}

export const startOfMonthUtc = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Billable provider requests by this user since the start of the current UTC month. */
export async function billableRequestsThisMonth(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`coalesce(sum(${usageLogs.requestCount}), 0)::int` })
    .from(usageLogs)
    .where(and(eq(usageLogs.userId, userId), eq(usageLogs.billable, true), gte(usageLogs.createdAt, startOfMonthUtc())));
  return row?.n ?? 0;
}

/** Number of usage rows for an operation in the last 24h (e.g. AI generations per day). */
export async function operationsLast24h(userId: string, operationPrefix: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`coalesce(sum(${usageLogs.requestCount}), 0)::int` })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, userId),
        sql`${usageLogs.operation} like ${operationPrefix + "%"}`,
        gte(usageLogs.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
      ),
    );
  return row?.n ?? 0;
}
