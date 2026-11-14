import "server-only";
import { gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { usageLogs, user } from "../db/schema";
import { env, isSampleMode } from "../env";
import type { UsageCell, UsageResponse, UsageRowDto } from "./types";

/** "YYYY-MM" keys for the last `n` UTC months, oldest first (current month last). */
export function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const zero = (): UsageCell => ({ requests: 0, costUsd: 0 });
const add = (a: UsageCell, b: UsageCell): UsageCell => ({ requests: a.requests + b.requests, costUsd: a.costUsd + b.costUsd });
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Billable provider requests and estimated cost per user and UTC month for the last `months` months.
 * Only users with billable usage in the period appear. Costs are estimates from the configured prices.
 */
export async function usageByUserMonth(opts: { months?: number; now?: Date } = {}): Promise<UsageResponse> {
  const now = opts.now ?? new Date();
  const months = lastMonths(opts.months ?? 6, now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months.length - 1), 1));

  const monthExpr = sql<string>`to_char(${usageLogs.createdAt} at time zone 'UTC', 'YYYY-MM')`;
  const agg = await db()
    .select({
      userId: usageLogs.userId,
      month: monthExpr,
      requests: sql<number>`coalesce(sum(${usageLogs.requestCount}) filter (where ${usageLogs.billable}), 0)::int`,
      costUsd: sql<number>`coalesce(sum(${usageLogs.estimatedCostUsd}) filter (where ${usageLogs.billable}), 0)::float8`,
    })
    .from(usageLogs)
    .where(gte(usageLogs.createdAt, start))
    .groupBy(usageLogs.userId, monthExpr);

  const byUser = new Map<string | null, UsageCell[]>();
  for (const r of agg) {
    const idx = months.indexOf(r.month);
    const requests = Number(r.requests) || 0;
    const costUsd = Number(r.costUsd) || 0;
    if (idx < 0 || (requests === 0 && costUsd === 0)) continue;
    const cells = byUser.get(r.userId) ?? months.map(zero);
    cells[idx] = add(cells[idx] ?? zero(), { requests, costUsd });
    byUser.set(r.userId, cells);
  }

  const ids = [...byUser.keys()].filter((k): k is string => k !== null);
  const people = ids.length
    ? await db().select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, ids))
    : [];
  const who = new Map(people.map((p) => [p.id, p]));

  const rows: UsageRowDto[] = [...byUser.entries()].map(([userId, cells]) => {
    const p = userId ? who.get(userId) : undefined;
    const total = cells.reduce(add, zero());
    return {
      userId,
      name: p?.name ?? null,
      email: p?.email ?? null,
      months: cells.map((c) => ({ requests: c.requests, costUsd: round4(c.costUsd) })),
      total: { requests: total.requests, costUsd: round4(total.costUsd) },
    };
  });
  rows.sort((a, b) => b.total.requests - a.total.requests || (a.email ?? "~").localeCompare(b.email ?? "~"));

  const totalsMonths = months.map((_, i) => rows.reduce((acc, r) => add(acc, r.months[i] ?? zero()), zero()));
  const grand = totalsMonths.reduce(add, zero());

  return {
    months,
    rows,
    totals: {
      months: totalsMonths.map((c) => ({ requests: c.requests, costUsd: round4(c.costUsd) })),
      total: { requests: grand.requests, costUsd: round4(grand.costUsd) },
    },
    pricing: {
      textSearchPer1000: env().GOOGLE_TEXT_SEARCH_PRICE_PER_1000,
      placeDetailsPer1000: env().GOOGLE_PLACE_DETAILS_PRICE_PER_1000,
    },
    sampleMode: isSampleMode(),
  };
}
