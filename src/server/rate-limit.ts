import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { HttpError } from "./errors";

/**
 * Fixed-window rate limit backed by Postgres (works across app instances).
 * Throws HttpError("rate_limited") when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const res = await db().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start = excluded.window_start then rate_limits.count + 1 else 1 end,
      window_start = excluded.window_start
    returning count
  `);
  const n = Number(res.rows[0]?.count ?? 1);
  if (n > limit) {
    throw new HttpError("rate_limited", "Too many requests — please slow down and try again shortly.", {
      retryAfterSeconds: Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000),
    });
  }
}
