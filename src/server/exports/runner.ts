import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { BusinessRow } from "@/lib/api-types";
import { FIELDS, isFieldKey, type FieldKey } from "@/lib/fields";
import { ListQueryError, validateListQuery, type ListQuery } from "@/lib/list-query";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { collections, exportsTable, searchJobs, user as userTable, type ExportRecord } from "../db/schema";
import { env } from "../env";
import { HttpError } from "../errors";
import { buildExportDocument, type SummaryMeta } from "./build";
import { buildCsv } from "./csv";
import { exportFileName, placeName } from "./filename";
import { defaultRowSource, type ExportTargetRef, type RowSource } from "./row-source";
import { contextFor, EXPORT_MAX_ROWS, FILTERED_PAGE_SIZE } from "./schemas";
import {
  ExportFailure,
  FILE_RETENTION_HOURS,
  GENERIC_FAILURE_MESSAGE,
  RESULTS_EXPIRED_MESSAGE,
  type ExportDeps,
} from "./shared";
import { storageKeyFor, writeExportFile } from "./storage";
import { buildXlsx } from "./xlsx";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a search's transient results may no longer be used (purged, or past the retention window). */
export function searchResultsExpired(job: { resultsPurgedAt: Date | null; resultsExpireAt: Date | null }, now: Date): boolean {
  return Boolean(job.resultsPurgedAt) || Boolean(job.resultsExpireAt && job.resultsExpireAt.getTime() <= now.getTime());
}

type Collected = { rows: BusinessRow[]; rowsMatching: number | null; rowsRequested: number | null; excludedRowCount: number };

const dedupe = (rows: BusinessRow[], seen = new Set<string>()) =>
  rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

/** Read every row for the export in the query's sort order (paged for "all filtered rows"). */
export async function collectRows(
  source: RowSource,
  user: AppUser,
  ref: ExportTargetRef,
  scope: ExportRecord["scope"],
  query: ListQuery,
  rowIds: string[] | null,
): Promise<Collected> {
  if (scope === "selected") {
    const ids = [...new Set(rowIds ?? [])].slice(0, EXPORT_MAX_ROWS);
    const rows = ids.length ? dedupe(await source.byIds(user, ref, ids, { sort: query.sort })) : [];
    return { rows, rowsMatching: null, rowsRequested: ids.length, excludedRowCount: Math.max(0, ids.length - rows.length) };
  }
  if (scope === "page") {
    const res = await source.list(user, ref, query);
    return { rows: dedupe(res.rows), rowsMatching: res.total, rowsRequested: null, excludedRowCount: 0 };
  }
  // filtered: everything matching, in sort order, at most EXPORT_MAX_ROWS.
  const seen = new Set<string>();
  const out: BusinessRow[] = [];
  let pageSize = FILTERED_PAGE_SIZE;
  let total = 0;
  for (let page = 1; out.length < EXPORT_MAX_ROWS; page++) {
    const res = await source.list(user, ref, { ...query, page, pageSize });
    if (page === 1) {
      total = res.total;
      // A source may clamp the page size; keep paging with the size it actually used.
      if (res.pageSize > 0 && res.pageSize !== pageSize) pageSize = res.pageSize;
    }
    out.push(...dedupe(res.rows, seen));
    if (res.rows.length < pageSize || out.length >= total) break;
  }
  return { rows: out.slice(0, EXPORT_MAX_ROWS), rowsMatching: total, rowsRequested: null, excludedRowCount: 0 };
}

async function loadUser(userId: string): Promise<AppUser> {
  const [u] = await db()
    .select({ id: userTable.id, name: userTable.name, email: userTable.email, role: userTable.role, status: userTable.status })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!u || u.status !== "active") throw new ExportFailure("Your account is not active, so this export was stopped.");
  return u;
}

async function loadTarget(rec: ExportRecord, now: Date): Promise<{ ref: ExportTargetRef; meta: SummaryMeta; nameParts: (string | null)[] }> {
  if (rec.target === "search") {
    const [job] = rec.jobId
      ? await db()
          .select()
          .from(searchJobs)
          .where(and(eq(searchJobs.id, rec.jobId), eq(searchJobs.userId, rec.userId)))
          .limit(1)
      : [];
    if (!job) throw new ExportFailure("This search no longer exists, so it can't be exported.");
    if (searchResultsExpired(job, now)) throw new ExportFailure(RESULTS_EXPIRED_MESSAGE);
    return {
      ref: { target: "search", jobId: job.id },
      meta: {
        target: "search",
        query: job.query,
        locationLabel: job.location?.label ?? null,
        kind: job.kind,
        sourceUrl: job.sourceUrl,
        provider: job.provider,
      },
      nameParts: [job.query, placeName(job.location)],
    };
  }
  const [c] = rec.collectionId
    ? await db()
        .select()
        .from(collections)
        .where(and(eq(collections.id, rec.collectionId), eq(collections.userId, rec.userId)))
        .limit(1)
    : [];
  if (!c) throw new ExportFailure("This collection no longer exists, so it can't be exported.");
  return {
    ref: { target: "collection", collectionId: c.id },
    meta: { target: "collection", collectionName: c.name, description: c.description },
    nameParts: [c.name],
  };
}

type Generated = Pick<ExportRecord, "rowCount" | "excludedRowCount" | "excludedFields" | "storageKey" | "fileName" | "finishedAt" | "expiresAt">;

/** Build the file for an export record and store it. Throws ExportFailure with a user-facing message. */
async function generate(rec: ExportRecord, deps: ExportDeps): Promise<Generated> {
  const now = deps.now?.() ?? new Date();
  const user = await loadUser(rec.userId);
  const { ref, meta, nameParts } = await loadTarget(rec, now);
  const context = contextFor(rec.target);

  let query: ListQuery;
  try {
    query = validateListQuery(rec.query, context);
  } catch (e) {
    if (e instanceof ListQueryError) throw new ExportFailure("The filters or sort order of this export are no longer supported. Please export again.");
    throw e;
  }
  const columns = rec.columns.filter((c): c is FieldKey => isFieldKey(c) && FIELDS[c].contexts.includes(context));
  if (!columns.length) throw new ExportFailure("None of the chosen columns can be exported. Please choose the columns again.");

  let collected: Collected;
  try {
    collected = await collectRows(deps.rowSource ?? defaultRowSource, user, ref, rec.scope, query, rec.rowIds);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.code === "not_found") throw new ExportFailure("The search or collection to export no longer exists.");
      throw new ExportFailure(e.message);
    }
    throw e;
  }

  const expiresAt = new Date(now.getTime() + FILE_RETENTION_HOURS * 3600_000);
  const doc = buildExportDocument({
    rows: collected.rows,
    columns,
    context,
    scope: rec.scope,
    query,
    meta,
    generatedAt: now,
    rowsMatching: collected.rowsMatching,
    rowsRequested: collected.rowsRequested,
    excludedRowCount: collected.excludedRowCount,
    rowLimit: rec.scope === "filtered" ? EXPORT_MAX_ROWS : null,
    fileExpiresAt: expiresAt,
    linkTtlMinutes: Math.max(1, env().EXPORT_LINK_TTL_MINUTES),
  });
  const fileName = exportFileName(nameParts, now, rec.format);
  const data =
    rec.format === "csv"
      ? buildCsv(
          doc.columns.map((c) => c.header),
          doc.rows,
        )
      : await buildXlsx(doc, { generatedAt: now, title: fileName });
  const storageKey = storageKeyFor(rec.userId, rec.id, rec.format);
  await writeExportFile(storageKey, data);

  return {
    rowCount: doc.rowCount,
    excludedRowCount: collected.excludedRowCount,
    excludedFields: doc.excludedFields.map((e) => ({ field: e.field, reason: e.reason, rows: e.rows })),
    storageKey,
    fileName,
    finishedAt: deps.now?.() ?? new Date(),
    expiresAt,
  };
}

/**
 * Generate the file for a queued export. Records failures on the export row (never throws for
 * export problems). Idempotent: an export that is already ready, failed or expired is left alone.
 */
export async function runExport(exportId: string, deps: ExportDeps = {}): Promise<void> {
  if (!UUID_RE.test(exportId)) return;
  const [rec] = await db()
    .update(exportsTable)
    .set({ status: "running", error: null })
    .where(and(eq(exportsTable.id, exportId), inArray(exportsTable.status, ["queued", "running"])))
    .returning();
  if (!rec) return;

  try {
    const result = await generate(rec, deps);
    await db()
      .update(exportsTable)
      .set({ ...result, status: "ready", error: null })
      .where(and(eq(exportsTable.id, rec.id), eq(exportsTable.status, "running")));
  } catch (e) {
    const message = e instanceof ExportFailure ? e.message : GENERIC_FAILURE_MESSAGE;
    if (!(e instanceof ExportFailure)) console.error("[exports] export failed", exportId, e);
    await db()
      .update(exportsTable)
      .set({ status: "failed", error: message, finishedAt: deps.now?.() ?? new Date() })
      .where(eq(exportsTable.id, rec.id));
  }
}
