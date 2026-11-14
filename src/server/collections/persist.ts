import "server-only";
import { and, eq, getTableColumns, notExists, sql, type SQL } from "drizzle-orm";
import type { SourceId } from "@/lib/domain";
import type { AppUser } from "../auth/session";
import type { DbOrTx } from "../db";
import { businesses, leads, type SearchResult } from "../db/schema";
import { businessValuesFromResult, type NewBusiness } from "./policy-columns";

/** Rows per multi-row upsert (≈40 columns each keeps us far below Postgres' 65 535 parameters). */
const UPSERT_BATCH = 500;

const NOT_REFRESHED = new Set(["id", "userId", "source", "sourceRecordId", "createdAt", "updatedAt"]);

/**
 * ON CONFLICT … DO UPDATE assignments: every stored column takes the incoming value. Columns the
 * policy forbids storing arrive as NULL, so a re-save also clears anything stored under an older policy.
 * Column names come from the schema, never from user input.
 */
const REFRESH_SET = (() => {
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(getTableColumns(businesses))) {
    if (!NOT_REFRESHED.has(key)) set[key] = sql.raw(`excluded."${col.name}"`);
  }
  set.updatedAt = sql`now()`;
  // Typed as the generic column→SQL map drizzle accepts; built dynamically so new columns are never missed.
  return set as Partial<Record<keyof NewBusiness, SQL>>;
})();

export const businessKey = (source: SourceId, sourceRecordId: string) => `${source}\u0000${sourceRecordId}`;

/**
 * Upsert the user's persisted business records for these search results, applying the source policy
 * column by column (see policy-columns.ts). Existing records (same user, source and provider ID) are
 * refreshed unless they were retrieved more recently than the incoming result.
 * Returns businessKey(source, sourceRecordId) → businesses.id.
 */
export async function upsertBusinessesFromResults(
  tx: DbOrTx,
  user: Pick<AppUser, "id">,
  results: readonly SearchResult[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  // One row per record key (a single INSERT … ON CONFLICT may not touch the same row twice).
  const unique = new Map<string, SearchResult>();
  for (const r of results) {
    const key = businessKey(r.source, r.sourceRecordId);
    const prev = unique.get(key);
    if (!prev || prev.retrievedAt < r.retrievedAt) unique.set(key, r);
  }
  const all = [...unique.values()];
  const now = new Date();

  for (let start = 0; start < all.length; start += UPSERT_BATCH) {
    const batch = all.slice(start, start + UPSERT_BATCH);
    await tx
      .insert(businesses)
      .values(batch.map((r) => businessValuesFromResult(r, user.id, now)))
      .onConflictDoUpdate({
        target: [businesses.userId, businesses.source, businesses.sourceRecordId],
        set: REFRESH_SET,
        setWhere: sql`${businesses.retrievedAt} <= excluded.retrieved_at`,
      });

    // Read ids back (rows skipped by setWhere are not RETURNed by the upsert).
    const bySource = new Map<SourceId, string[]>();
    for (const r of batch) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.sourceRecordId]);
    for (const [source, recordIds] of bySource) {
      const rows = await tx
        .select({ id: businesses.id, sourceRecordId: businesses.sourceRecordId })
        .from(businesses)
        .where(
          and(
            eq(businesses.userId, user.id),
            eq(businesses.source, source),
            sql`${businesses.sourceRecordId} = any(${sql.param(recordIds)}::text[])`,
          ),
        );
      for (const row of rows) ids.set(businessKey(source, row.sourceRecordId), row.id);
    }
  }
  return ids;
}

/** Upsert one search result as a persisted business (policy applied). Returns businesses.id. */
export async function upsertBusinessFromResult(tx: DbOrTx, user: Pick<AppUser, "id">, result: SearchResult): Promise<string> {
  const ids = await upsertBusinessesFromResults(tx, user, [result]);
  const id = ids.get(businessKey(result.source, result.sourceRecordId));
  if (!id) throw new Error("Business upsert did not return a row");
  return id;
}

/**
 * Delete the user's business records (among `businessIds`) that no lead references any more —
 * we keep provider-derived data only while the user is actually using it.
 */
export async function deleteOrphanBusinesses(tx: DbOrTx, userId: string, businessIds: readonly string[]): Promise<number> {
  if (!businessIds.length) return 0;
  const unique = [...new Set(businessIds)];
  const deleted = await tx
    .delete(businesses)
    .where(
      and(
        eq(businesses.userId, userId),
        sql`${businesses.id} = any(${sql.param(unique)}::uuid[])`,
        notExists(tx.select({ one: sql`1` }).from(leads).where(eq(leads.businessId, businesses.id))),
      ),
    )
    .returning({ id: businesses.id });
  return deleted.length;
}
