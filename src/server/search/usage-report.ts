import "server-only";
import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { usageLogs, user as userTable } from "../db/schema";
import { startOfMonthUtc } from "../usage";

export const USAGE_REPORT_MONTHS = 6;

export type UsageReportRow = {
  /** "YYYY-MM" (UTC). */
  month: string;
  provider: string;
  operation: string;
  requests: number;
  billableRequests: number;
  estimatedCostUsd: number;
  /** Only in the all-users report. null when the usage belongs to a deleted account. */
  user?: { id: string; name: string; email: string } | null;
};

export type UsageReport = {
  scope: "me" | "all";
  /** Months covered, newest first ("YYYY-MM"). */
  months: string[];
  rows: UsageReportRow[];
  totals: { requests: number; billableRequests: number; estimatedCostUsd: number };
};

/** The last `n` calendar months (UTC), newest first, and the start of the oldest one. */
export function monthsBack(n: number, now: Date = new Date()): { months: string[]; start: Date } {
  const first = startOfMonthUtc(now);
  const months: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { months, start: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - (n - 1), 1)) };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * GET /api/v1/usage: provider requests and estimated cost for the last 6 months grouped by month,
 * provider and operation. `all` (admins only — checked by the route) groups by user as well.
 */
export async function usageReport(viewer: Pick<AppUser, "id">, opts: { all?: boolean; now?: Date; months?: number } = {}): Promise<UsageReport> {
  const all = opts.all === true;
  const { months, start } = monthsBack(opts.months ?? USAGE_REPORT_MONTHS, opts.now);
  const month = sql<string>`to_char(${usageLogs.createdAt} at time zone 'UTC', 'YYYY-MM')`;
  const requests = sql<number>`coalesce(sum(${usageLogs.requestCount}), 0)::int`;
  const billable = sql<number>`coalesce(sum(${usageLogs.requestCount}) filter (where ${usageLogs.billable}), 0)::int`;
  const cost = sql<number>`coalesce(sum(${usageLogs.estimatedCostUsd}), 0)::float8`;
  const where: SQL = all ? gte(usageLogs.createdAt, start) : and(eq(usageLogs.userId, viewer.id), gte(usageLogs.createdAt, start))!;

  let rows: UsageReportRow[];
  if (all) {
    const raw = await db()
      .select({
        month,
        provider: usageLogs.provider,
        operation: usageLogs.operation,
        requests,
        billable,
        cost,
        userId: usageLogs.userId,
        userName: userTable.name,
        userEmail: userTable.email,
      })
      .from(usageLogs)
      .leftJoin(userTable, eq(userTable.id, usageLogs.userId))
      .where(where)
      .groupBy(month, usageLogs.provider, usageLogs.operation, usageLogs.userId, userTable.name, userTable.email)
      .orderBy(sql`1 desc`, userTable.email, usageLogs.provider, usageLogs.operation);
    rows = raw.map((r) => ({
      month: r.month,
      provider: r.provider,
      operation: r.operation,
      requests: Number(r.requests),
      billableRequests: Number(r.billable),
      estimatedCostUsd: round4(Number(r.cost)),
      user: r.userId && r.userEmail ? { id: r.userId, name: r.userName ?? "", email: r.userEmail } : null,
    }));
  } else {
    const raw = await db()
      .select({ month, provider: usageLogs.provider, operation: usageLogs.operation, requests, billable, cost })
      .from(usageLogs)
      .where(where)
      .groupBy(month, usageLogs.provider, usageLogs.operation)
      .orderBy(sql`1 desc`, usageLogs.provider, usageLogs.operation);
    rows = raw.map((r) => ({
      month: r.month,
      provider: r.provider,
      operation: r.operation,
      requests: Number(r.requests),
      billableRequests: Number(r.billable),
      estimatedCostUsd: round4(Number(r.cost)),
    }));
  }

  const totals = rows.reduce(
    (t, r) => ({
      requests: t.requests + r.requests,
      billableRequests: t.billableRequests + r.billableRequests,
      estimatedCostUsd: round4(t.estimatedCostUsd + r.estimatedCostUsd),
    }),
    { requests: 0, billableRequests: 0, estimatedCostUsd: 0 },
  );
  return { scope: all ? "all" : "me", months, rows, totals };
}
