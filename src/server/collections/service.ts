import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { CollectionDto } from "@/lib/api-types";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/domain";
import { MAX_BULK_ROWS, validateListQuery, type ListQuery } from "@/lib/list-query";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db, type DbOrTx } from "../db";
import { buildFilterConditions, buildOrderBy, RESULTS_GRID } from "../db/list-sql";
import { collections, leads, searchJobs, searchResults, type Collection, type SearchResult } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { isUuid } from "../http";
import { businessKey, deleteOrphanBusinesses, upsertBusinessesFromResults } from "./persist";
import type { CreateCollectionInput, UpdateCollectionInput } from "./schemas";

type Opts = { ip?: string | null };

/* ───────────────────────────── helpers ───────────────────────────── */

/** Load a collection owned by the user or throw 404. */
export async function getOwnedCollection(user: Pick<AppUser, "id">, collectionId: string, tx: DbOrTx = db()): Promise<Collection> {
  const [c] = await tx
    .select()
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, user.id)))
    .limit(1);
  if (!c) throw notFound("Collection");
  return c;
}

/** Bump a collection's updated_at (recently used collections are listed first). */
export async function touchCollection(tx: DbOrTx, collectionIds: string[]) {
  for (const id of new Set(collectionIds)) {
    await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, id));
  }
}

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    if (typeof cur === "object" && (cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const duplicateName = (name: string) => new HttpError("conflict", `You already have a collection called “${name}”.`);

type Counts = Map<string, Partial<Record<LeadStatus, number>>>;

async function statusCounts(userId: string, collectionId?: string): Promise<Counts> {
  const rows = await db()
    .select({ collectionId: leads.collectionId, status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.userId, userId), collectionId ? eq(leads.collectionId, collectionId) : undefined))
    .groupBy(leads.collectionId, leads.status);
  const out: Counts = new Map();
  for (const r of rows) {
    const m = out.get(r.collectionId) ?? {};
    m[r.status] = Number(r.n);
    out.set(r.collectionId, m);
  }
  return out;
}

function toDto(c: Collection, counts: Partial<Record<LeadStatus, number>> = {}): CollectionDto {
  const statusCounts: Partial<Record<LeadStatus, number>> = {};
  let leadCount = 0;
  for (const s of LEAD_STATUSES) {
    const n = counts[s];
    if (n) {
      statusCounts[s] = n;
      leadCount += n;
    }
  }
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    leadCount,
    statusCounts,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/* ───────────────────────────── CRUD ───────────────────────────── */

/** The user's collections, most recently used first, with lead counts per status. */
export async function listCollections(user: AppUser): Promise<CollectionDto[]> {
  const [rows, counts] = await Promise.all([
    db().select().from(collections).where(eq(collections.userId, user.id)).orderBy(desc(collections.updatedAt), asc(collections.name)),
    statusCounts(user.id),
  ]);
  return rows.map((c) => toDto(c, counts.get(c.id)));
}

export async function getCollection(user: AppUser, collectionId: string): Promise<CollectionDto> {
  const c = await getOwnedCollection(user, collectionId);
  const counts = await statusCounts(user.id, c.id);
  return toDto(c, counts.get(c.id));
}

async function assertNameFree(tx: DbOrTx, userId: string, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(
        eq(collections.userId, userId),
        sql`lower(${collections.name}) = lower(${name})`,
        exceptId ? sql`${collections.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (clash) throw duplicateName(name);
}

export async function createCollection(user: AppUser, input: CreateCollectionInput, opts: Opts = {}): Promise<CollectionDto> {
  await assertNameFree(db(), user.id, input.name);
  let created: Collection | undefined;
  try {
    [created] = await db()
      .insert(collections)
      .values({ userId: user.id, name: input.name, description: input.description ?? null })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicateName(input.name); // lost a race with a parallel request
    throw e;
  }
  if (!created) throw new Error("Collection insert returned nothing");
  await audit({ actorId: user.id, action: "collection.create", resourceType: "collection", resourceId: created.id, ip: opts.ip });
  return toDto(created);
}

/** Rename and/or re-describe a collection. */
export async function renameCollection(user: AppUser, collectionId: string, patch: UpdateCollectionInput, opts: Opts = {}): Promise<CollectionDto> {
  const current = await getOwnedCollection(user, collectionId);
  const set: Partial<Pick<Collection, "name" | "description">> = {};
  if (patch.name !== undefined && patch.name !== current.name) {
    if (patch.name.toLowerCase() !== current.name.toLowerCase()) await assertNameFree(db(), user.id, patch.name, current.id);
    set.name = patch.name;
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length) {
    try {
      await db()
        .update(collections)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(collections.id, current.id), eq(collections.userId, user.id)));
    } catch (e) {
      if (isUniqueViolation(e) && set.name) throw duplicateName(set.name);
      throw e;
    }
    await audit({
      actorId: user.id,
      action: "collection.update",
      resourceType: "collection",
      resourceId: current.id,
      metadata: { fields: Object.keys(set) },
      ip: opts.ip,
    });
  }
  return getCollection(user, current.id);
}

/** Alias kept for readability at call sites (PATCH /collections/{id}). */
export const updateCollection = renameCollection;

/** Delete a collection with its leads (and any business record no other lead uses). */
export async function deleteCollection(user: AppUser, collectionId: string, opts: Opts = {}): Promise<void> {
  const removed = await db().transaction(async (tx) => {
    const c = await getOwnedCollection(user, collectionId, tx);
    const gone = await tx
      .delete(leads)
      .where(and(eq(leads.collectionId, c.id), eq(leads.userId, user.id)))
      .returning({ businessId: leads.businessId });
    await tx.delete(collections).where(and(eq(collections.id, c.id), eq(collections.userId, user.id)));
    await deleteOrphanBusinesses(tx, user.id, gone.map((g) => g.businessId));
    return gone.length;
  });
  await audit({
    actorId: user.id,
    action: "collection.delete",
    resourceType: "collection",
    resourceId: collectionId,
    metadata: { leads: removed },
    ip: opts.ip,
  });
}

/* ───────────────────────────── adding results ───────────────────────────── */

export type AddToCollectionInput = { jobId: string; resultIds: string[] } | { jobId: string; query: ListQuery | Record<string, unknown> };

/**
 * Save search results as leads. Ownership of both the job and the collection is checked.
 * `resultIds`: those results (ids of other jobs/users are ignored). `query`: every result matching the
 * results-grid filters (≤ MAX_BULK_ROWS, in the grid's sort order). Leads already in the collection are skipped.
 */
export async function addToCollection(
  user: AppUser,
  collectionId: string,
  input: AddToCollectionInput,
  opts: Opts = {},
): Promise<{ added: number; skipped: number }> {
  const query = "query" in input ? validateListQuery(input.query, "results") : null;

  const result = await db().transaction(async (tx) => {
    const collection = await getOwnedCollection(user, collectionId, tx);
    const [job] = await tx
      .select({ id: searchJobs.id, resultsPurgedAt: searchJobs.resultsPurgedAt, resultsExpireAt: searchJobs.resultsExpireAt })
      .from(searchJobs)
      .where(and(eq(searchJobs.id, input.jobId), eq(searchJobs.userId, user.id)))
      .limit(1);
    if (!job) throw notFound("Search");
    // Past the source's retention window the results may no longer be used, even before the purge job ran.
    if (job.resultsPurgedAt || (job.resultsExpireAt && job.resultsExpireAt.getTime() <= Date.now())) {
      throw new HttpError("conflict", "The results of this search have expired and can no longer be saved. Run the search again to get fresh results.");
    }

    const scope = and(eq(searchResults.jobId, job.id), eq(searchResults.userId, user.id));
    let rows: SearchResult[];
    if (query) {
      rows = await tx
        .select()
        .from(searchResults)
        .where(and(scope, ...buildFilterConditions(query.filters, query.search, RESULTS_GRID)))
        .orderBy(...buildOrderBy(query, RESULTS_GRID))
        .limit(MAX_BULK_ROWS);
    } else {
      const ids = [...new Set(("resultIds" in input ? input.resultIds : []).filter(isUuid))];
      rows = ids.length
        ? await tx
            .select()
            .from(searchResults)
            .where(and(scope, sql`${searchResults.id} = any(${sql.param(ids)}::uuid[])`))
            .orderBy(...RESULTS_GRID.tieBreakers)
        : [];
    }
    if (!rows.length) return { added: 0, skipped: 0, requested: 0 };

    const keyToId = await upsertBusinessesFromResults(tx, user, rows);
    const businessIds: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const id = keyToId.get(businessKey(r.source, r.sourceRecordId));
      if (id && !seen.has(id)) {
        seen.add(id);
        businessIds.push(id);
      }
    }

    // created_at steps back 1 µs per row so the collection's default order (newest first) keeps the results' order.
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into ${leads} (collection_id, business_id, user_id, created_at, updated_at)
      select ${collection.id}::uuid, b.id, ${user.id}::text, now() - (b.ord * interval '1 microsecond'), now()
      from unnest(${sql.param(businessIds)}::uuid[]) with ordinality as b(id, ord)
      on conflict (collection_id, business_id) do nothing
      returning id
    `);
    const added = inserted.rows.length;
    if (added) await touchCollection(tx, [collection.id]);
    return { added, skipped: businessIds.length - added, requested: rows.length };
  });

  await audit({
    actorId: user.id,
    action: "collection.add",
    resourceType: "collection",
    resourceId: collectionId,
    metadata: { jobId: input.jobId, mode: query ? "query" : "ids", matched: result.requested, added: result.added, skipped: result.skipped },
    ip: opts.ip,
  });
  return { added: result.added, skipped: result.skipped };
}
