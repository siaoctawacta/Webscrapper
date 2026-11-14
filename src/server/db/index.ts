import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the db. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __leadfinderPool?: Pool; __leadfinderDb?: Db };

export function getPool(): Pool {
  if (!globalForDb.__leadfinderPool) {
    globalForDb.__leadfinderPool = new Pool({
      connectionString: env().DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
  }
  return globalForDb.__leadfinderPool;
}

export function getDb(): Db {
  if (!globalForDb.__leadfinderDb) {
    globalForDb.__leadfinderDb = drizzle(getPool(), { schema, casing: "snake_case" });
  }
  return globalForDb.__leadfinderDb;
}

/** Shorthand used across the server code: `db().select()...` */
export const db = getDb;

export async function closeDb() {
  await globalForDb.__leadfinderPool?.end();
  globalForDb.__leadfinderPool = undefined;
  globalForDb.__leadfinderDb = undefined;
}

export { schema };
