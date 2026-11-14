import "server-only";
import { and, count, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { BusinessRow, Facet, ListResponse } from "@/lib/api-types";
import { MAX_BULK_ROWS, type ListQuery } from "@/lib/list-query";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { buildFilterConditions, buildOrderBy, RESULTS_GRID } from "../db/list-sql";
import { searchJobs, searchResults, type SearchJob } from "../db/schema";
import { isUuid, notFound } from "../http";
import { policyInfo } from "../providers/policy";
import { searchResultToRow } from "../rows";

type UserRef = Pick<AppUser, "id">;

const jobNotFound = () => notFound("Search");
const resultNotFound = () => notFound("Result");

/** Load a job owned by the user or throw HttpError not_found. */
export async function getOwnedJob(user: UserRef, jobId: string): Promise<SearchJob> {
  if (!isUuid(jobId)) throw jobNotFound();
  const [job] = await db()
    .select()
    .from(searchJobs)
    .where(and(eq(searchJobs.id, jobId), eq(searchJobs.userId, user.id)))
    .limit(1);
  if (!job) throw jobNotFound();
  return job;
}

/** Rows of one job, owned by the user (both conditions are always part of the query). */
const jobScope = (user: UserRef, jobId: string): SQL => and(eq(searchResults.jobId, jobId), eq(searchResults.userId, user.id))!;

function whereFor(user: UserRef, jobId: string, query: Pick<ListQuery, "filters" | "search">): SQL {
  return and(jobScope(user, jobId), ...buildFilterConditions(query.filters, query.search, RESULTS_GRID))!;
}

const facetRows = (rows: { value: string | null; count: number }[]): Facet[] =>
  rows.filter((r): r is { value: string; count: number } => r.value !== null).map((r) => ({ value: r.value, count: Number(r.count) }));

/** Facets over all of the job's rows (not narrowed by the user's filters, so every option stays listed). */
export async function searchResultFacets(user: UserRef, jobId: string): Promise<ListResponse["facets"]> {
  const scope = jobScope(user, jobId);
  const n = sql<number>`count(*)::int`;
  const [categories, cities, websiteStatus] = await Promise.all([
    db()
      .select({ value: searchResults.category, count: n })
      .from(searchResults)
      .where(and(scope, isNotNull(searchResults.category)))
      .groupBy(searchResults.category)
      .orderBy(desc(n), searchResults.category)
      .limit(50),
    db()
      .select({ value: searchResults.city, count: n })
      .from(searchResults)
      .where(and(scope, isNotNull(searchResults.city)))
      .groupBy(searchResults.city)
      .orderBy(desc(n), searchResults.city)
      .limit(30),
    db()
      .select({ value: searchResults.websiteStatus, count: n })
      .from(searchResults)
      .where(scope)
      .groupBy(searchResults.websiteStatus)
      .orderBy(desc(n), searchResults.websiteStatus),
  ]);
  return { categories: facetRows(categories), cities: facetRows(cities), websiteStatus: facetRows(websiteStatus) };
}

/** One page of results (sorted/filtered server-side) with facets and source policies. */
export async function listSearchResults(user: AppUser, jobId: string, query: ListQuery): Promise<ListResponse> {
  const job = await getOwnedJob(user, jobId);
  const where = whereFor(user, job.id, query);
  const [totalRow, rows, facets] = await Promise.all([
    db().select({ n: count() }).from(searchResults).where(where),
    db()
      .select()
      .from(searchResults)
      .where(where)
      .orderBy(...buildOrderBy(query, RESULTS_GRID))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    searchResultFacets(user, job.id),
  ]);
  return {
    rows: rows.map(searchResultToRow),
    total: Number(totalRow[0]?.n ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    query,
    facets,
    policies: [policyInfo(job.provider)],
  };
}

/** All ids matching the query (for "select all filtered"), capped at MAX_BULK_ROWS, in sort order. */
export async function listSearchResultIds(user: AppUser, jobId: string, query: ListQuery): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  const job = await getOwnedJob(user, jobId);
  const where = whereFor(user, job.id, query);
  const [totalRow, rows] = await Promise.all([
    db().select({ n: count() }).from(searchResults).where(where),
    db()
      .select({ id: searchResults.id })
      .from(searchResults)
      .where(where)
      .orderBy(...buildOrderBy(query, RESULTS_GRID))
      .limit(MAX_BULK_ROWS),
  ]);
  const total = Number(totalRow[0]?.n ?? 0);
  return { ids: rows.map((r) => r.id), total, truncated: total > MAX_BULK_ROWS };
}

/** Rows by id (owned by user, in the given job), in the query's sort order. Unknown ids are skipped. */
export async function getSearchResultsByIds(user: AppUser, jobId: string, ids: string[], query?: Pick<ListQuery, "sort">): Promise<BusinessRow[]> {
  const job = await getOwnedJob(user, jobId);
  const wanted = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))].slice(0, MAX_BULK_ROWS);
  if (wanted.length === 0) return [];
  const rows = await db()
    .select()
    .from(searchResults)
    .where(and(jobScope(user, job.id), sql`${searchResults.id} = any(${sql.param(wanted)}::uuid[])`))
    .orderBy(...buildOrderBy(query ?? { sort: [] }, RESULTS_GRID));
  return rows.map(searchResultToRow);
}

/** One result owned by the user (any of their jobs, or only within `jobId` when given). */
export async function getSearchResult(user: AppUser, resultId: string, jobId?: string): Promise<BusinessRow> {
  if (!isUuid(resultId) || (jobId !== undefined && !isUuid(jobId))) throw resultNotFound();
  const [row] = await db()
    .select()
    .from(searchResults)
    .where(
      and(
        eq(searchResults.id, resultId),
        eq(searchResults.userId, user.id),
        jobId !== undefined ? eq(searchResults.jobId, jobId) : undefined,
      ),
    )
    .limit(1);
  if (!row) throw resultNotFound();
  return searchResultToRow(row);
}
