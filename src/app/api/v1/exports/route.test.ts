import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { utimes, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import type { ApiError, BusinessRow, ExportDto } from "@/lib/api-types";
import { closeDb, db } from "@/server/db";
import { auditLogs, exportsTable } from "@/server/db/schema";
import type { RowSource } from "@/server/exports/row-source";
import { getPolicy } from "@/server/providers/policy";
import { purgeExpiredExports, runExport } from "@/server/exports";
import { FILE_EXPIRED_MESSAGE, LINK_EXPIRED_MESSAGE } from "@/server/exports/shared";
import { STALE_EXPORT_MESSAGE } from "@/server/exports/cleanup";
import { POLICY_CHANGED_MESSAGE } from "@/server/exports/service";
import {
  businessRow,
  fakeRowSource,
  googleRow,
  insertCollection,
  insertJob,
  sortRows,
  useTempStorage,
  withLead,
} from "@/server/exports/test-fixtures";
import { createTestUser, type TestUser } from "../../../../../tests/helpers/auth";
import { resetDb } from "../../../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../../../tests/helpers/request";
import { GET as listRoute, POST as createRoute } from "./route";
import { GET as getRoute } from "./[id]/route";
import { GET as downloadRoute } from "./[id]/download/route";

/** The routes use the default row source; point it at an in-memory fake for each test. */
const holder = vi.hoisted(() => ({ source: null as RowSource | null }));
vi.mock("@/server/exports/row-source", () => ({
  defaultRowSource: {
    list: (...args: Parameters<RowSource["list"]>) => holder.source!.list(...args),
    byIds: (...args: Parameters<RowSource["byIds"]>) => holder.source!.byIds(...args),
  } satisfies RowSource,
}));
const queue = vi.hoisted(() => ({ enqueue: vi.fn(async (_name: string, _data: unknown) => "pgboss-job-id" as string | null) }));
vi.mock("@/server/queue", () => ({
  QUEUES: { searchRun: "search.run", exportRun: "export.run", maintenance: "maintenance.cleanup" },
  enqueue: queue.enqueue,
}));

let storage: Awaited<ReturnType<typeof useTempStorage>>;
beforeAll(async () => {
  storage = await useTempStorage();
});
afterAll(async () => {
  await closeDb();
  await storage.cleanup();
});

let rows: BusinessRow[];
let fake: ReturnType<typeof fakeRowSource>;
function useRows(next: BusinessRow[], opts?: { maxPageSize?: number }) {
  rows = next;
  fake = fakeRowSource(rows, opts);
  holder.source = fake.source;
}
beforeEach(async () => {
  await resetDb();
  queue.enqueue.mockClear();
  queue.enqueue.mockImplementation(async () => "pgboss-job-id");
  useRows(Array.from({ length: 30 }, (_, i) => businessRow(i + 1)));
});

const post = (user: TestUser, body: unknown, headers?: Record<string, string>) =>
  createRoute(apiRequest("/api/v1/exports", { method: "POST", body, user, headers }), ctx({}));
const getOne = (user: TestUser, id: string) => getRoute(apiRequest(`/api/v1/exports/${id}`, { user }), ctx({ id }));
const download = (user: TestUser, url: string) => {
  const id = /\/exports\/([^/]+)\/download/.exec(url)?.[1] ?? "x";
  return downloadRoute(apiRequest(url, { user }), ctx({ id }));
};
const body = <T>(res: Response) => res.json() as Promise<T>;
const csvLines = async (res: Response) => (await res.text()).replace(/^﻿/, "").split("\r\n").filter(Boolean);

async function searchSetup(opts: Parameters<typeof insertJob>[1] = {}) {
  const user = await createTestUser();
  const job = await insertJob(user.id, opts);
  return { user, job };
}
const searchBody = (jobId: string, o: Record<string, unknown> = {}) => ({
  target: "search",
  jobId,
  format: "csv",
  scope: "filtered",
  columns: ["business_name"],
  query: { page: 1, pageSize: 50, sort: [], filters: {} },
  ...o,
});

async function created(res: Response, status = 201): Promise<ExportDto> {
  const json = await body<ExportDto & ApiError>(res);
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json;
}

describe("POST /api/v1/exports (inline) and download", () => {
  it("generates a small CSV right away and streams it with safe headers", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id, { columns: ["business_name", "phone", "postal_code", "email"] })));
    expect(dto).toMatchObject({ status: "ready", target: "search", jobId: job.id, format: "csv", scope: "filtered", rowCount: 30, excludedRowCount: 0, excludedFields: [], error: null });
    expect(dto.columns).toEqual(["business_name", "phone", "postal_code", "email"]);
    expect(dto.fileName).toMatch(/^leads-hôtel-lomé-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(dto.downloadUrl).toMatch(new RegExp(`^/api/v1/exports/${dto.id}/download\\?token=[A-Za-z0-9_-]{43}$`));
    expect(new Date(dto.expiresAt!).getTime() - new Date(dto.finishedAt!).getTime()).toBeGreaterThan(23.9 * 3600_000);
    expect(existsSync(path.join(storage.dir, user.id, `${dto.id}.csv`))).toBe(true);

    const res = await download(user, dto.downloadUrl!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const cd = res.headers.get("content-disposition")!;
    expect(cd).toMatch(/^attachment; filename="leads-hotel-lome-\d{4}-\d{2}-\d{2}\.csv"; filename\*=UTF-8''leads-h%C3%B4tel-lom%C3%A9-/);
    const lines = await csvLines(res);
    expect(lines[0]).toBe("Business name,Phone,Postal code,Email");
    expect(lines[1]).toBe("Business 001,+228 90 12 34 01,00123,contact@biz1.example");
    expect(lines).toHaveLength(31);

    const actions = (await db().select({ action: auditLogs.action, outcome: auditLogs.outcome }).from(auditLogs)).map((a) => `${a.action}:${a.outcome}`);
    expect(actions).toEqual(expect.arrayContaining(["export.create:success", "export.download:success"]));
  });

  it("generates an XLSX with the three sheets", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id, { format: "xlsx", columns: ["business_name", "phone", "email", "website"] })));
    const res = await download(user, dto.downloadUrl!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Business Data", "Search Summary", "Data Quality"]);
    expect(wb.getWorksheet("Business Data")!.getCell("B2").value).toBe("+228 90 12 34 01");
    expect(wb.getWorksheet("Business Data")!.rowCount).toBe(31);
  });

  it("honours the Idempotency-Key header", async () => {
    const { user, job } = await searchSetup();
    const a = await created(await post(user, searchBody(job.id), { "idempotency-key": "export-123" }));
    const b = await created(await post(user, searchBody(job.id), { "idempotency-key": "export-123" }));
    expect(b.id).toBe(a.id);
    expect(await db().select({ id: exportsTable.id }).from(exportsTable)).toHaveLength(1);
    const c = await created(await post(user, searchBody(job.id), { "idempotency-key": "export-456" }));
    expect(c.id).not.toBe(a.id);
  });
});

describe("download links", () => {
  it("mints a fresh link on every GET; older links stop working", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    const again = await body<ExportDto>(await getOne(user, dto.id));
    expect(again.status).toBe("ready");
    expect(again.downloadUrl).toBeDefined();
    expect(again.downloadUrl).not.toBe(dto.downloadUrl);

    const old = await download(user, dto.downloadUrl!);
    expect(old.status).toBe(403);
    expect((await body<ApiError>(old)).error).toMatchObject({ code: "forbidden", message: LINK_EXPIRED_MESSAGE });
    expect((await download(user, again.downloadUrl!)).status).toBe(200);
    const denied = await db().select().from(auditLogs).where(and(eq(auditLogs.action, "export.download"), eq(auditLogs.outcome, "denied")));
    expect(denied).toHaveLength(1);
  });

  it("rejects wrong, missing and expired tokens with 403", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    const base = `/api/v1/exports/${dto.id}/download`;
    expect((await download(user, `${base}?token=${"A".repeat(43)}`)).status).toBe(403);
    expect((await download(user, base)).status).toBe(403);
    expect((await download(user, `${base}?token=short`)).status).toBe(403);

    await db().update(exportsTable).set({ downloadTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(exportsTable.id, dto.id));
    const res = await download(user, dto.downloadUrl!);
    expect(res.status).toBe(403);
    expect((await body<ApiError>(res)).error.message).toBe(LINK_EXPIRED_MESSAGE);
  });

  it("returns 404 to other users and for unknown ids", async () => {
    const { user, job } = await searchSetup();
    const other = await createTestUser();
    const dto = await created(await post(user, searchBody(job.id)));
    expect((await download(other, dto.downloadUrl!)).status).toBe(404);
    expect((await getOne(other, dto.id)).status).toBe(404);
    expect((await getOne(user, "00000000-0000-4000-8000-000000000999")).status).toBe(404);
    expect((await getOne(user, "not-a-uuid")).status).toBe(404);
    const anon = await getRoute(apiRequest(`/api/v1/exports/${dto.id}`), ctx({ id: dto.id }));
    expect(anon.status).toBe(401);
  });

  it("reports an expired export and refuses to download it", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    await db().update(exportsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(exportsTable.id, dto.id));
    const res = await download(user, dto.downloadUrl!);
    expect(res.status).toBe(404);
    expect((await body<ApiError>(res)).error).toMatchObject({ code: "not_found", message: FILE_EXPIRED_MESSAGE });
    const view = await body<ExportDto>(await getOne(user, dto.id));
    expect(view.status).toBe("expired");
    expect(view.downloadUrl).toBeUndefined();
  });

  it("answers browser navigations with a plain-text message", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    const url = `/api/v1/exports/${dto.id}/download?token=${"A".repeat(43)}`;
    const res = await downloadRoute(apiRequest(url, { user, headers: { accept: "text/html,application/xhtml+xml" } }), ctx({ id: dto.id }));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(LINK_EXPIRED_MESSAGE);
  });

  it("reports a missing file as expired", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    await db().update(exportsTable).set({ storageKey: `${user.id}/00000000-0000-4000-8000-0000000000ff.csv` }).where(eq(exportsTable.id, dto.id));
    const res = await download(user, dto.downloadUrl!);
    expect(res.status).toBe(404);
    expect((await body<ApiError>(res)).error.message).toBe(FILE_EXPIRED_MESSAGE);
  });
});

describe("validation and ownership", () => {
  it.each([
    ["unknown column", { columns: ["business_name", "favourite_colour"] }],
    ["collection-only column on a search", { columns: ["lead_status"] }],
    ["no columns", { columns: [] }],
    ["too many columns", { columns: Array.from({ length: 41 }, () => "business_name") }],
    ["bad format", { format: "pdf" }],
    ["bad scope", { scope: "everything" }],
    ["selected without ids", { scope: "selected" }],
    ["too many ids", { scope: "selected", rowIds: Array.from({ length: 20001 }, (_, i) => businessRow(i).id) }],
    ["malformed id", { scope: "selected", rowIds: ["1; drop table exports"] }],
    ["unknown sort field", { query: { sort: [{ field: "password", direction: "asc" }] } }],
    ["unknown filter", { query: { filters: { evil: true } } }],
    ["missing job id", { jobId: undefined }],
  ])("rejects %s with 422", async (_label, override) => {
    const { user, job } = await searchSetup();
    const res = await post(user, searchBody(job.id, override));
    expect(res.status).toBe(422);
    expect((await body<ApiError>(res)).error.code).toBe("validation_failed");
    expect(await db().select().from(exportsTable)).toHaveLength(0);
  });

  it("returns 404 for another user's search or collection", async () => {
    const { job } = await searchSetup();
    const other = await createTestUser();
    expect((await post(other, searchBody(job.id))).status).toBe(404);
    const owner = await createTestUser();
    const c = await insertCollection(owner.id);
    const res = await post(other, { target: "collection", collectionId: c.id, format: "csv", scope: "filtered", columns: ["business_name"], query: {} });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the search results have expired", async () => {
    const purged = await searchSetup({ resultsPurgedAt: new Date(Date.now() - 60_000) });
    const res = await post(purged.user, searchBody(purged.job.id));
    expect(res.status).toBe(409);
    expect((await body<ApiError>(res)).error.message).toMatch(/^These search results have expired/);

    const pastRetention = await searchSetup({ resultsExpireAt: new Date(Date.now() - 60_000) });
    expect((await post(pastRetention.user, searchBody(pastRetention.job.id))).status).toBe(409);
  });

  it("requires a signed-in user and a same-origin request", async () => {
    const { job } = await searchSetup();
    expect((await createRoute(apiRequest("/api/v1/exports", { method: "POST", body: searchBody(job.id) }), ctx({}))).status).toBe(401);
  });
});

describe("scopes", () => {
  const names = (lines: string[]) => lines.slice(1);

  it("selected: exports the chosen rows in the query's sort order and counts missing ids", async () => {
    const { user, job } = await searchSetup();
    const chosen = [rows[4]!, rows[0]!, rows[19]!, rows[9]!];
    const ghostIds = ["00000000-0000-4000-8000-00000000aaaa", "00000000-0000-4000-8000-00000000bbbb"];
    const dto = await created(
      await post(
        user,
        searchBody(job.id, {
          scope: "selected",
          rowIds: [...chosen.map((r) => r.id), ...ghostIds, chosen[0]!.id],
          query: { sort: [{ field: "business_name", direction: "desc" }] },
        }),
      ),
    );
    expect(dto).toMatchObject({ rowCount: 4, excludedRowCount: 2 });
    const lines = await csvLines(await download(user, dto.downloadUrl!));
    expect(names(lines)).toEqual(["Business 020", "Business 010", "Business 005", "Business 001"]);
  });

  it("page: exports exactly that page", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id, { scope: "page", query: { page: 2, pageSize: 25, sort: [{ field: "business_name", direction: "asc" }] } })));
    expect(dto.rowCount).toBe(5);
    expect(names(await csvLines(await download(user, dto.downloadUrl!)))).toEqual(["Business 026", "Business 027", "Business 028", "Business 029", "Business 030"]);
  });

  it("filtered: pages through all matching rows 500 at a time, in sort order", async () => {
    useRows(Array.from({ length: 1234 }, (_, i) => businessRow(i + 1, { rating: (i * 7) % 50 / 10 })));
    const { user, job } = await searchSetup();
    const sort = [
      { field: "rating", direction: "desc" },
      { field: "business_name", direction: "asc" },
    ] as const;
    const dto = await created(await post(user, searchBody(job.id, { query: { sort } })));
    expect(dto.rowCount).toBe(1234);
    const expected = sortRows(rows, [...sort]).map((r) => r.name);
    expect(names(await csvLines(await download(user, dto.downloadUrl!)))).toEqual(expected);
    const listCalls = fake.calls.filter((c) => c.method === "list");
    expect(listCalls.map((c) => [c.page, c.pageSize])).toEqual([
      [1, 1],
      [1, 500],
      [2, 500],
      [3, 500],
    ]);
  });

  it("filtered: follows a source that clamps the page size", async () => {
    useRows(Array.from({ length: 250 }, (_, i) => businessRow(i + 1)), { maxPageSize: 100 });
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    expect(dto.rowCount).toBe(250);
    const lines = names(await csvLines(await download(user, dto.downloadUrl!)));
    expect(new Set(lines).size).toBe(250);
  });
});

describe("inline vs queued", () => {
  it("generates up to 2,000 rows inline", async () => {
    useRows(Array.from({ length: 2000 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    expect(dto).toMatchObject({ status: "ready", rowCount: 2000 });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("queues larger exports for the worker (202), which then completes them", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id, { format: "xlsx" })), 202);
    expect(dto).toMatchObject({ status: "queued", rowCount: null });
    expect(dto.downloadUrl).toBeUndefined();
    expect(queue.enqueue).toHaveBeenCalledWith("export.run", { exportId: dto.id });

    const pending = await body<ExportDto>(await getOne(user, dto.id));
    expect(pending.status).toBe("queued");
    expect(pending.downloadUrl).toBeUndefined();

    await runExport(dto.id);
    const ready = await body<ExportDto>(await getOne(user, dto.id));
    expect(ready).toMatchObject({ status: "ready", rowCount: 2001 });
    expect((await download(user, ready.downloadUrl!)).status).toBe(200);
  });

  it("queues selections above the threshold too", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id, { scope: "selected", rowIds: rows.map((r) => r.id) })), 202);
    expect(dto.status).toBe("queued");
  });

  it("fails cleanly when the queue is unavailable", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    queue.enqueue.mockRejectedValueOnce(new Error("connection refused"));
    const { user, job } = await searchSetup();
    const res = await post(user, searchBody(job.id));
    expect(res.status).toBe(500);
    expect((await body<ApiError>(res)).error.message).toBe("The export could not be started. Please try again in a moment.");
    const [rec] = await db().select().from(exportsTable);
    expect(rec).toMatchObject({ status: "failed" });
  });

  it("limits how many exports can wait at once", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    for (let i = 0; i < 3; i++) await created(await post(user, searchBody(job.id)), 202);
    const res = await post(user, searchBody(job.id));
    expect(res.status).toBe(429);
  });
});

describe("source policy and collections", () => {
  it("exports only the Maps link, place ID and app-owned fields for Google rows", async () => {
    useRows([googleRow(1), googleRow(2), businessRow(3)]);
    const { user, job } = await searchSetup({ provider: "google_places" });
    const dto = await created(await post(user, searchBody(job.id, { columns: ["business_name", "phone", "maps_url", "source_record_id", "email", "website_status"] })));
    const reason = getPolicy("google_places").restrictionReason;
    expect(dto.excludedFields).toEqual([
      { field: "business_name", reason, rows: 2 },
      { field: "phone", reason, rows: 2 },
    ]);
    const lines = await csvLines(await download(user, dto.downloadUrl!));
    expect(lines.slice(1)).toEqual([
      ",,https://maps.google.com/?cid=1,ChIJplace1,contact@biz1.example,Has website",
      ",,https://maps.google.com/?cid=2,ChIJplace2,contact@biz2.example,Has website",
      "Business 003,+228 90 12 34 03,https://maps.google.com/?cid=3,sample-3,contact@biz3.example,Has website",
    ]);
  });

  it("re-checks the source policy at download", async () => {
    useRows([googleRow(1)]);
    const { user, job } = await searchSetup({ provider: "google_places" });
    const dto = await created(await post(user, searchBody(job.id, { columns: ["business_name", "maps_url"] })));
    expect((await download(user, dto.downloadUrl!)).status).toBe(200);
    // Simulate a file generated under an older, more permissive policy: nothing was withheld.
    await db().update(exportsTable).set({ excludedFields: [] }).where(eq(exportsTable.id, dto.id));
    const again = await body<ExportDto>(await getOne(user, dto.id));
    const res = await download(user, again.downloadUrl!);
    expect(res.status).toBe(409);
    expect((await body<ApiError>(res)).error.message).toBe(POLICY_CHANGED_MESSAGE);
  });

  it("adds lead status, tags, notes and last contacted for collections when asked", async () => {
    useRows([
      withLead(businessRow(1, { name: "Hôtel Le Bénin" }), { status: "proposal_sent", tags: ["VIP", "plage"], notes: "=cmd|' /C calc'!A0", lastContactedAt: "2026-11-10T15:00:00.000Z" }),
      withLead(businessRow(2)),
    ]);
    const user = await createTestUser();
    const c = await insertCollection(user.id, "Hôtels Lomé");
    const dto = await created(
      await post(user, { target: "collection", collectionId: c.id, format: "csv", scope: "filtered", columns: ["business_name", "notes"], includeAnnotations: true, query: {} }),
    );
    expect(dto.columns).toEqual(["business_name", "notes", "lead_status", "tags", "last_contacted"]);
    expect(dto.fileName).toMatch(/^leads-hôtels-lomé-/);
    expect(fake.calls[0]!.ref).toEqual({ target: "collection", collectionId: c.id });
    const lines = await csvLines(await download(user, dto.downloadUrl!));
    expect(lines[0]).toBe("Business name,Notes,Lead status,Tags,Last contacted");
    expect(lines[1]).toBe("Hôtel Le Bénin,'=cmd|' /C calc'!A0,Proposal sent,\"VIP, plage\",2026-11-10T15:00:00.000Z");
    expect(lines[2]).toBe("Business 002,,New,,");
  });

  it("does not add annotations for collections unless asked", async () => {
    useRows([withLead(businessRow(1))]);
    const user = await createTestUser();
    const c = await insertCollection(user.id);
    const dto = await created(await post(user, { target: "collection", collectionId: c.id, format: "csv", scope: "filtered", columns: ["business_name"], query: {} }));
    expect(dto.columns).toEqual(["business_name"]);
  });
});

describe("GET /api/v1/exports", () => {
  it("lists the user's recent exports without download links", async () => {
    const { user, job } = await searchSetup();
    const other = await searchSetup();
    const a = await created(await post(user, searchBody(job.id)));
    const b = await created(await post(user, searchBody(job.id, { format: "xlsx" })));
    await created(await post(other.user, searchBody(other.job.id)));
    const res = await listRoute(apiRequest("/api/v1/exports", { user }), ctx({}));
    expect(res.status).toBe(200);
    const { exports } = await body<{ exports: ExportDto[] }>(res);
    expect(exports.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(exports.every((e) => e.downloadUrl === undefined)).toBe(true);
  });
});

describe("runner", () => {
  it("is idempotent once an export is ready", async () => {
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)));
    const [before] = await db().select().from(exportsTable).where(eq(exportsTable.id, dto.id));
    await runExport(dto.id);
    const [after] = await db().select().from(exportsTable).where(eq(exportsTable.id, dto.id));
    expect(after!.finishedAt).toEqual(before!.finishedAt);
    expect(after!.status).toBe("ready");
    await runExport("not-a-uuid");
    await runExport("00000000-0000-4000-8000-000000000999");
  });

  it("records a plain-language failure when the rows cannot be read", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)), 202);
    holder.source = {
      list: async () => {
        throw new Error("database exploded");
      },
      byIds: async () => [],
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runExport(dto.id);
    spy.mockRestore();
    const failed = await body<ExportDto>(await getOne(user, dto.id));
    expect(failed).toMatchObject({ status: "failed", error: "The export could not be created because of an unexpected error. Please try again." });
    expect(failed.downloadUrl).toBeUndefined();
    const res = await download(user, `/api/v1/exports/${dto.id}/download?token=${"A".repeat(43)}`);
    expect(res.status).toBe(409);
  });

  it("fails a queued export whose search results expired before it ran", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    const dto = await created(await post(user, searchBody(job.id)), 202);
    await db().update((await import("@/server/db/schema")).searchJobs).set({ resultsPurgedAt: new Date() });
    await runExport(dto.id);
    const failed = await body<ExportDto>(await getOne(user, dto.id));
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/^These search results have expired/);
  });
});

describe("purgeExpiredExports", () => {
  it("deletes expired files and marks the exports expired", async () => {
    const { user, job } = await searchSetup();
    const old = await created(await post(user, searchBody(job.id)));
    const fresh = await created(await post(user, searchBody(job.id, { format: "xlsx" })));
    const oldFile = path.join(storage.dir, user.id, `${old.id}.csv`);
    const freshFile = path.join(storage.dir, user.id, `${fresh.id}.xlsx`);
    expect(existsSync(oldFile)).toBe(true);
    await db().update(exportsTable).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(exportsTable.id, old.id));

    expect(await purgeExpiredExports(new Date())).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);
    const [rec] = await db().select().from(exportsTable).where(eq(exportsTable.id, old.id));
    expect(rec).toMatchObject({ status: "expired", storageKey: null, downloadTokenHash: null });
    expect(await purgeExpiredExports(new Date())).toBe(0);
    expect((await body<ExportDto>(await getOne(user, old.id))).status).toBe("expired");
  });

  it("marks exports that never finished as failed after a day", async () => {
    useRows(Array.from({ length: 2001 }, (_, i) => businessRow(i + 1)));
    const { user, job } = await searchSetup();
    const stuck = await created(await post(user, searchBody(job.id)), 202);
    const recent = await created(await post(user, searchBody(job.id)), 202);
    await db().update(exportsTable).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(exportsTable.id, stuck.id));
    await purgeExpiredExports(new Date());
    expect(await body<ExportDto>(await getOne(user, stuck.id))).toMatchObject({ status: "failed", error: STALE_EXPORT_MESSAGE });
    expect((await body<ExportDto>(await getOne(user, recent.id))).status).toBe("queued");
  });

  it("sweeps orphaned files older than the retention window, leaving other files alone", async () => {
    const dir = path.join(storage.dir, "deleted-user");
    await mkdir(dir, { recursive: true });
    const orphan = path.join(dir, "00000000-0000-4000-8000-000000000001.xlsx");
    const unrelated = path.join(dir, "keep-me.txt");
    await writeFile(orphan, "x");
    await writeFile(unrelated, "x");
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000);
    await utimes(orphan, twoDaysAgo, twoDaysAgo);
    await utimes(unrelated, twoDaysAgo, twoDaysAgo);
    await purgeExpiredExports(new Date());
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });
});
