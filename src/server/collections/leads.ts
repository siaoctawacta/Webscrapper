import "server-only";
import { and, count, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { BusinessRow, Facet, ListResponse } from "@/lib/api-types";
import { LEAD_STATUSES, SOURCE_IDS, type LeadStatus, type SourceId } from "@/lib/domain";
import { MAX_BULK_ROWS, type ListQuery } from "@/lib/list-query";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { buildFilterConditions, buildOrderBy, COLLECTION_GRID } from "../db/list-sql";
import { businesses, leads, type Lead } from "../db/schema";
import { HttpError, isUuid, notFound } from "../http";
import { policyInfo } from "../providers/policy";
import { leadToRow } from "../rows";
import { hydrateRows, type HydrateDeps } from "./hydrate";
import { deleteOrphanBusinesses } from "./persist";
import { getOwnedCollection } from "./service";
import { normalizeTags, TagError } from "./tags";

export type LeadsDeps = { hydrate?: HydrateDeps };

/** Leads of one collection, owned by the user (businesses are per user too). */
const collectionScope = (user: Pick<AppUser, "id">, collectionId: string): SQL =>
  and(eq(leads.collectionId, collectionId), eq(leads.userId, user.id), eq(businesses.userId, user.id))!;

const joined = () =>
  db().select({ lead: leads, business: businesses }).from(leads).innerJoin(businesses, eq(businesses.id, leads.businessId));

const maybeHydrate = (user: AppUser, rows: BusinessRow[], hydrate: boolean | undefined, deps?: LeadsDeps) =>
  hydrate === false ? rows : hydrateRows(user, rows, deps?.hydrate);

const facetRows = (rows: { value: string | null; count: number }[]): Facet[] =>
  rows.filter((r): r is { value: string; count: number } => r.value !== null).map((r) => ({ value: r.value, count: Number(r.count) }));

/** Facets over the whole collection (so filter panels list every option), plus the sources present. */
async function collectionFacets(user: AppUser, collectionId: string) {
  const scope = collectionScope(user, collectionId);
  const n = sql<number>`count(*)::int`;
  const [categories, cities, websiteStatus, tags, leadStatus, sources] = await Promise.all([
    db()
      .select({ value: businesses.category, count: n })
      .from(leads)
      .innerJoin(businesses, eq(businesses.id, leads.businessId))
      .where(and(scope, isNotNull(businesses.category)))
      .groupBy(businesses.category)
      .orderBy(desc(n), businesses.category)
      .limit(50),
    db()
      .select({ value: businesses.city, count: n })
      .from(leads)
      .innerJoin(businesses, eq(businesses.id, leads.businessId))
      .where(and(scope, isNotNull(businesses.city)))
      .groupBy(businesses.city)
      .orderBy(desc(n), businesses.city)
      .limit(30),
    db()
      .select({ value: businesses.websiteStatus, count: n })
      .from(leads)
      .innerJoin(businesses, eq(businesses.id, leads.businessId))
      .where(scope)
      .groupBy(businesses.websiteStatus)
      .orderBy(desc(n)),
    db().execute<{ value: string; count: number }>(sql`
      select t.value, count(*)::int as count
      from ${leads} cross join lateral unnest(${leads.tags}) as t(value)
      where ${leads.collectionId} = ${collectionId}::uuid and ${leads.userId} = ${user.id}
      group by t.value
      order by count(*) desc, t.value asc
      limit 50
    `),
    db()
      .select({ value: leads.status, count: n })
      .from(leads)
      .where(and(eq(leads.collectionId, collectionId), eq(leads.userId, user.id)))
      .groupBy(leads.status),
    db()
      .selectDistinct({ source: businesses.source })
      .from(leads)
      .innerJoin(businesses, eq(businesses.id, leads.businessId))
      .where(scope),
  ]);
  const statusOrder = (s: string) => LEAD_STATUSES.indexOf(s as LeadStatus);
  return {
    facets: {
      categories: facetRows(categories),
      cities: facetRows(cities),
      websiteStatus: facetRows(websiteStatus),
      tags: facetRows(tags.rows),
      leadStatus: facetRows(leadStatus).sort((a, b) => statusOrder(a.value) - statusOrder(b.value)),
    },
    sources: sources.map((s) => s.source).filter((s): s is SourceId => (SOURCE_IDS as readonly string[]).includes(s)),
  };
}

/** One page of leads in a collection owned by the user. hydrate (default true) loads restricted fields live. */
export async function listLeads(
  user: AppUser,
  collectionId: string,
  query: ListQuery,
  opts?: { hydrate?: boolean },
  deps?: LeadsDeps,
): Promise<ListResponse> {
  await getOwnedCollection(user, collectionId);
  const where = and(collectionScope(user, collectionId), ...buildFilterConditions(query.filters, query.search, COLLECTION_GRID));
  const [page, totalRows, meta] = await Promise.all([
    joined()
      .where(where)
      .orderBy(...buildOrderBy(query, COLLECTION_GRID))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db().select({ n: count() }).from(leads).innerJoin(businesses, eq(businesses.id, leads.businessId)).where(where),
    collectionFacets(user, collectionId),
  ]);
  const rows = page.map((r) => leadToRow(r.lead, r.business));
  let liveDetailsLimited = false;
  const hydrateDeps = { ...deps?.hydrate, onLimited: () => (liveDetailsLimited = true) };
  const hydrated = await maybeHydrate(user, rows, opts?.hydrate, { ...deps, hydrate: hydrateDeps });
  return {
    ...(liveDetailsLimited ? { liveDetailsLimited } : {}),
    rows: hydrated,
    total: Number(totalRows[0]?.n ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    query,
    facets: meta.facets,
    policies: meta.sources.map(policyInfo),
  };
}

/** All lead ids matching the query (for "select all filtered"), capped at MAX_BULK_ROWS, in sort order. */
export async function listLeadIds(
  user: AppUser,
  collectionId: string,
  query: ListQuery,
): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  await getOwnedCollection(user, collectionId);
  const where = and(collectionScope(user, collectionId), ...buildFilterConditions(query.filters, query.search, COLLECTION_GRID));
  const [rows, totalRows] = await Promise.all([
    db()
      .select({ id: leads.id })
      .from(leads)
      .innerJoin(businesses, eq(businesses.id, leads.businessId))
      .where(where)
      .orderBy(...buildOrderBy(query, COLLECTION_GRID))
      .limit(MAX_BULK_ROWS),
    db().select({ n: count() }).from(leads).innerJoin(businesses, eq(businesses.id, leads.businessId)).where(where),
  ]);
  const total = Number(totalRows[0]?.n ?? 0);
  return { ids: rows.map((r) => r.id), total, truncated: total > rows.length };
}

/**
 * Leads by id (owned by user, in the collection), in the query's sort order. Unknown ids are ignored.
 * Hydration (default true) covers at most one page (see MAX_HYDRATED_ROWS); pass { hydrate: false }
 * for bulk use such as exports.
 */
export async function getLeadsByIds(
  user: AppUser,
  collectionId: string,
  ids: string[],
  query?: Pick<ListQuery, "sort">,
  opts?: { hydrate?: boolean },
  deps?: LeadsDeps,
): Promise<BusinessRow[]> {
  await getOwnedCollection(user, collectionId);
  const valid = [...new Set(ids.filter(isUuid))];
  if (!valid.length) return [];
  const rows = await joined()
    .where(and(collectionScope(user, collectionId), sql`${leads.id} = any(${sql.param(valid)}::uuid[])`))
    .orderBy(...buildOrderBy(query ?? { sort: [] }, COLLECTION_GRID));
  return maybeHydrate(
    user,
    rows.map((r) => leadToRow(r.lead, r.business)),
    opts?.hydrate,
    deps,
  );
}

/** A single lead (owned by user) as a row, hydrated by default. */
export async function getLeadRow(user: AppUser, leadId: string, opts?: { hydrate?: boolean }, deps?: LeadsDeps): Promise<BusinessRow> {
  if (!isUuid(leadId)) throw notFound("Lead");
  const [r] = await joined()
    .where(and(eq(leads.id, leadId), eq(leads.userId, user.id), eq(businesses.userId, user.id)))
    .limit(1);
  if (!r) throw notFound("Lead");
  const [row] = await maybeHydrate(user, [leadToRow(r.lead, r.business)], opts?.hydrate, deps);
  return row!;
}

/* ───────────────────────────── edits ───────────────────────────── */

/** Statuses that mean "we reached out": they stamp last_contacted_at. */
export const CONTACT_STATUSES: readonly LeadStatus[] = ["contacted", "proposal_sent"];

export type LeadPatch = { status?: LeadStatus; tags?: string[]; notes?: string };

/** Normalize tags or throw a 422 with a plain-language message. */
export function tagsOrThrow(tags: readonly string[]): string[] {
  try {
    return normalizeTags(tags);
  } catch (e) {
    if (e instanceof TagError) throw new HttpError("validation_failed", e.message, [{ path: "tags", message: e.message }]);
    throw e;
  }
}

/**
 * Update a lead's status / tags / notes. Setting status contacted or proposal_sent stamps
 * last_contacted_at. Returns the row without live hydration (the grid keeps the provider fields it already shows).
 */
export async function updateLead(user: AppUser, leadId: string, patch: LeadPatch, opts: { ip?: string | null } = {}): Promise<BusinessRow> {
  if (!isUuid(leadId)) throw notFound("Lead");
  const set: Partial<Pick<Lead, "status" | "tags" | "notes" | "lastContactedAt" | "updatedAt">> = {};
  if (patch.status !== undefined) {
    set.status = patch.status;
    if (CONTACT_STATUSES.includes(patch.status)) set.lastContactedAt = new Date();
  }
  if (patch.tags !== undefined) set.tags = tagsOrThrow(patch.tags);
  if (patch.notes !== undefined) set.notes = patch.notes;

  if (Object.keys(set).length) {
    set.updatedAt = new Date();
    const updated = await db()
      .update(leads)
      .set(set)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .returning({ id: leads.id, collectionId: leads.collectionId });
    if (!updated.length) throw notFound("Lead");
    await audit({
      actorId: user.id,
      action: "lead.update",
      resourceType: "lead",
      resourceId: leadId,
      metadata: {
        collectionId: updated[0]!.collectionId,
        fields: Object.keys(patch).filter((k) => patch[k as keyof LeadPatch] !== undefined),
        ...(patch.status ? { status: patch.status } : {}),
      },
      ip: opts.ip,
    });
  }
  return getLeadRow(user, leadId, { hydrate: false });
}

/** Remove a lead from its collection. */
export async function deleteLead(user: AppUser, leadId: string, opts: { ip?: string | null } = {}): Promise<void> {
  if (!isUuid(leadId)) throw notFound("Lead");
  const gone = await db().transaction(async (tx) => {
    const rows = await tx
      .delete(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .returning({ businessId: leads.businessId, collectionId: leads.collectionId });
    if (!rows.length) throw notFound("Lead");
    await deleteOrphanBusinesses(tx, user.id, rows.map((r) => r.businessId));
    return rows[0]!;
  });
  await audit({
    actorId: user.id,
    action: "lead.remove",
    resourceType: "lead",
    resourceId: leadId,
    metadata: { collectionId: gone.collectionId },
    ip: opts.ip,
  });
}
