import "server-only";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import type { ExportDto } from "@/lib/api-types";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { collections, exportsTable, searchJobs, type ExportRecord } from "../db/schema";
import { env } from "../env";
import { HttpError, notFound } from "../errors";
import { enqueue as queueEnqueue, QUEUES } from "../queue";
import { rateLimit } from "../rate-limit";
import { resolveColumns } from "./columns";
import { contentDisposition } from "./filename";
import { defaultRowSource } from "./row-source";
import { runExport, searchResultsExpired } from "./runner";
import { EXPORT_MAX_ROWS, INLINE_ROW_LIMIT, parseCreateExportInput } from "./schemas";
import {
  FILE_EXPIRED_MESSAGE,
  LINK_EXPIRED_MESSAGE,
  RESULTS_EXPIRED_MESSAGE,
  effectiveStatus,
  toExportDto,
  type ExportDeps,
} from "./shared";
import { isFieldKey } from "@/lib/fields";
import { canExport } from "../providers/policy";
import { openExportFile } from "./storage";
import { mintDownloadToken, tokenMatches } from "./tokens";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Exports a user may have waiting or running at the same time. */
export const MAX_PENDING_EXPORTS_PER_USER = 3;
/** New exports per user per hour. */
export const EXPORTS_PER_HOUR = 60;
export const LIST_LIMIT = 50;

export const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

const nowOf = (deps: ExportDeps) => deps.now?.() ?? new Date();

async function ownedExport(user: Pick<AppUser, "id">, exportId: string): Promise<ExportRecord> {
  if (!UUID_RE.test(exportId)) throw notFound("Export");
  const [rec] = await db()
    .select()
    .from(exportsTable)
    .where(and(eq(exportsTable.id, exportId), eq(exportsTable.userId, user.id)))
    .limit(1);
  if (!rec) throw notFound("Export");
  return rec;
}

/** Store a fresh download token for a ready export and return its URL (previous links stop working). */
async function mintDownloadUrl(rec: ExportRecord, now: Date): Promise<string | undefined> {
  if (effectiveStatus(rec, now) !== "ready") return undefined;
  const { token, hash } = mintDownloadToken();
  const ttlMinutes = Math.max(1, env().EXPORT_LINK_TTL_MINUTES);
  await db()
    .update(exportsTable)
    .set({ downloadTokenHash: hash, downloadTokenExpiresAt: new Date(now.getTime() + ttlMinutes * 60_000) })
    .where(and(eq(exportsTable.id, rec.id), eq(exportsTable.userId, rec.userId)));
  return `/api/v1/exports/${rec.id}/download?token=${token}`;
}

async function dtoWithLink(rec: ExportRecord, now: Date): Promise<ExportDto> {
  return toExportDto(rec, now, await mintDownloadUrl(rec, now));
}

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  if (!key) return null;
  if (key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new HttpError("validation_failed", "The Idempotency-Key header must be at most 200 visible ASCII characters.");
  }
  return key;
}

const findByIdempotencyKey = async (userId: string, key: string) =>
  (
    await db()
      .select()
      .from(exportsTable)
      .where(and(eq(exportsTable.userId, userId), eq(exportsTable.idempotencyKey, key)))
      .limit(1)
  )[0];

/**
 * POST /api/v1/exports. Validates the request, checks ownership, snapshots the query and either
 * generates the file right away (≤ INLINE_ROW_LIMIT rows → status "ready") or queues it
 * ("export.run" → status "queued"). Repeating a request with the same Idempotency-Key returns the
 * export created the first time.
 */
export async function createExport(
  user: AppUser,
  body: unknown,
  opts: { idempotencyKey?: string | null; ip?: string | null } = {},
  deps: ExportDeps = {},
): Promise<ExportDto> {
  const input = parseCreateExportInput(body);
  const idempotencyKey = normalizeIdempotencyKey(opts.idempotencyKey);
  const now = nowOf(deps);

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(user.id, idempotencyKey);
    if (existing) return dtoWithLink(existing, now);
  }

  // Ownership (in the query itself) and the source policy's retention window.
  if (input.ref.target === "search") {
    const [job] = await db()
      .select({ id: searchJobs.id, resultsPurgedAt: searchJobs.resultsPurgedAt, resultsExpireAt: searchJobs.resultsExpireAt })
      .from(searchJobs)
      .where(and(eq(searchJobs.id, input.ref.jobId), eq(searchJobs.userId, user.id)))
      .limit(1);
    if (!job) throw notFound("Search");
    if (searchResultsExpired(job, now)) throw new HttpError("conflict", RESULTS_EXPIRED_MESSAGE);
  } else {
    const [c] = await db()
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.id, input.ref.collectionId), eq(collections.userId, user.id)))
      .limit(1);
    if (!c) throw notFound("Collection");
  }

  await rateLimit(`exports:create:${user.id}`, EXPORTS_PER_HOUR, 3600);
  const [pending] = await db()
    .select({ n: count() })
    .from(exportsTable)
    .where(
      and(
        eq(exportsTable.userId, user.id),
        inArray(exportsTable.status, ["queued", "running"]),
        // Ignore exports stuck for over an hour (e.g. no worker running) so they never block new ones.
        gt(exportsTable.createdAt, new Date(now.getTime() - 3600_000)),
      ),
    );
  if (Number(pending?.n ?? 0) >= MAX_PENDING_EXPORTS_PER_USER) {
    throw new HttpError("rate_limited", "You already have exports being prepared. Please wait for them to finish, then try again.");
  }

  const source = deps.rowSource ?? defaultRowSource;
  let expectedRows: number;
  if (input.scope === "selected") expectedRows = input.rowIds?.length ?? 0;
  else if (input.scope === "page") expectedRows = input.query.pageSize;
  else expectedRows = Math.min(EXPORT_MAX_ROWS, (await source.list(user, input.ref, { ...input.query, page: 1, pageSize: 1 })).total);

  const columns = resolveColumns(input.columns, { includeAnnotations: input.includeAnnotations });
  const inserted = await db()
    .insert(exportsTable)
    .values({
      userId: user.id,
      target: input.ref.target,
      jobId: input.ref.target === "search" ? input.ref.jobId : null,
      collectionId: input.ref.target === "collection" ? input.ref.collectionId : null,
      format: input.format,
      scope: input.scope,
      columns,
      includeAnnotations: input.includeAnnotations,
      query: input.query,
      rowIds: input.rowIds,
      status: "queued",
      idempotencyKey,
    })
    .onConflictDoNothing({ target: [exportsTable.userId, exportsTable.idempotencyKey] })
    .returning();
  let rec = inserted[0];
  if (!rec) {
    // A concurrent request with the same Idempotency-Key won the race.
    const existing = idempotencyKey ? await findByIdempotencyKey(user.id, idempotencyKey) : undefined;
    if (!existing) throw new HttpError("conflict", "This export request is already being processed.");
    return dtoWithLink(existing, now);
  }

  const inline = expectedRows <= (deps.inlineRowLimit ?? INLINE_ROW_LIMIT);
  await audit({
    actorId: user.id,
    action: "export.create",
    resourceType: "export",
    resourceId: rec.id,
    metadata: {
      target: rec.target,
      jobId: rec.jobId,
      collectionId: rec.collectionId,
      format: rec.format,
      scope: rec.scope,
      columns: columns.length,
      expectedRows,
      mode: inline ? "inline" : "queued",
    },
    ip: opts.ip,
  });

  if (inline) {
    await runExport(rec.id, deps);
  } else {
    try {
      await (deps.enqueue ?? ((exportId: string) => queueEnqueue(QUEUES.exportRun, { exportId })))(rec.id);
    } catch (e) {
      console.error("[exports] could not queue export", rec.id, e);
      await db()
        .update(exportsTable)
        .set({ status: "failed", error: "The export could not be started. Please try again in a moment.", finishedAt: nowOf(deps) })
        .where(eq(exportsTable.id, rec.id));
      throw new HttpError("internal", "The export could not be started. Please try again in a moment.");
    }
  }
  rec = await ownedExport(user, rec.id);
  return dtoWithLink(rec, nowOf(deps));
}

/** GET /api/v1/exports/{id}: the export, with a fresh short-lived download link when it is ready. */
export async function getExport(user: AppUser, exportId: string, deps: Pick<ExportDeps, "now"> = {}): Promise<ExportDto> {
  return dtoWithLink(await ownedExport(user, exportId), nowOf(deps));
}

/** GET /api/v1/exports: the user's most recent exports (no download links — open one to get a link). */
export async function listExports(user: AppUser, deps: Pick<ExportDeps, "now"> = {}): Promise<ExportDto[]> {
  const now = nowOf(deps);
  const rows = await db()
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.userId, user.id))
    .orderBy(desc(exportsTable.createdAt), desc(exportsTable.id))
    .limit(LIST_LIMIT);
  return rows.map((r) => toExportDto(r, now));
}

export const POLICY_CHANGED_MESSAGE =
  "The data source's terms no longer allow some columns in this file. Please create the export again.";

/**
 * Source policy re-check at download: a search export's rows all come from the job's provider, so
 * every column that is not exportable for that provider today must have been withheld in the file.
 * (Files are also deleted after 24 hours, which bounds the window for collection exports.)
 */
async function assertPolicyStillAllows(rec: ExportRecord): Promise<void> {
  if (rec.target !== "search" || !rec.jobId || !rec.rowCount) return;
  const [job] = await db()
    .select({ provider: searchJobs.provider })
    .from(searchJobs)
    .where(and(eq(searchJobs.id, rec.jobId), eq(searchJobs.userId, rec.userId)))
    .limit(1);
  if (!job) return;
  const withheld = new Set(rec.excludedFields.map((e) => e.field));
  if (rec.columns.some((c) => isFieldKey(c) && !canExport(job.provider, c) && !withheld.has(c))) {
    throw new HttpError("conflict", POLICY_CHANGED_MESSAGE);
  }
}

/**
 * GET /api/v1/exports/{id}/download?token=… — owner only (others get 404), valid unexpired token
 * (403), file not expired (404). Streams the file and audits "export.download".
 */
export async function openDownload(
  user: AppUser,
  exportId: string,
  token: string | null,
  opts: { ip?: string | null } = {},
  deps: Pick<ExportDeps, "now"> = {},
): Promise<Response> {
  const now = nowOf(deps);
  const rec = await ownedExport(user, exportId);
  const status = effectiveStatus(rec, now);
  if (status === "queued" || status === "running") throw new HttpError("conflict", "This export is still being prepared. Please try again in a moment.");
  if (status === "failed") throw new HttpError("conflict", rec.error ?? "This export failed. Please create it again.");

  const tokenValid =
    tokenMatches(token, rec.downloadTokenHash) && Boolean(rec.downloadTokenExpiresAt && rec.downloadTokenExpiresAt.getTime() > now.getTime());
  if (!tokenValid) {
    await audit({ actorId: user.id, action: "export.download", resourceType: "export", resourceId: rec.id, outcome: "denied", metadata: { reason: "invalid_or_expired_token" }, ip: opts.ip });
    throw new HttpError("forbidden", LINK_EXPIRED_MESSAGE);
  }
  if (status !== "ready" || !rec.storageKey || !rec.fileName) throw new HttpError("not_found", FILE_EXPIRED_MESSAGE);
  await assertPolicyStillAllows(rec);

  const file = await openExportFile(rec.storageKey);
  if (!file) throw new HttpError("not_found", FILE_EXPIRED_MESSAGE);

  await audit({
    actorId: user.id,
    action: "export.download",
    resourceType: "export",
    resourceId: rec.id,
    metadata: { format: rec.format, rowCount: rec.rowCount, bytes: file.size },
    ip: opts.ip,
  });
  return new Response(file.stream, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[rec.format],
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(rec.fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
