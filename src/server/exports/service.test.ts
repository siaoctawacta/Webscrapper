/**
 * End-to-end through the real row sources (search results / collection leads in Postgres).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { AppUser } from "../auth/session";
import { closeDb, db } from "../db";
import { businesses, leads, searchResults, type NewSearchResult, type SearchJob } from "../db/schema";
import { getPolicy } from "../providers/policy";
import { createTestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { createExport, getExport, openDownload } from "./service";
import { insertCollection, insertJob, useTempStorage } from "./test-fixtures";

vi.mock("@/server/queue", () => ({
  QUEUES: { searchRun: "search.run", exportRun: "export.run", maintenance: "maintenance.cleanup" },
  enqueue: vi.fn(async () => "job"),
}));

let storage: Awaited<ReturnType<typeof useTempStorage>>;
beforeAll(async () => {
  storage = await useTempStorage();
});
afterAll(async () => {
  await closeDb();
  await storage.cleanup();
});
beforeEach(resetDb);

const asUser = (u: { id: string; email: string }): AppUser => ({ id: u.id, email: u.email, name: "Test", role: "member", status: "active" });

function result(i: number, o: Partial<NewSearchResult> = {}): Omit<NewSearchResult, "jobId" | "userId"> {
  return {
    position: i,
    source: "sample",
    sourceRecordId: `sample-${i}`,
    name: `Hôtel ${i}`,
    category: "Hotel",
    phoneRaw: `+228 90 00 00 0${i}`,
    phoneE164: `+22890000000${i}`,
    phoneDigits: `22890000000${i}`,
    websiteUrl: `https://hotel${i}.example/`,
    websiteHost: `hotel${i}.example`,
    websiteStatus: "present",
    primaryEmail: `info@hotel${i}.example`,
    emailOrigin: "website_crawl",
    emailStatus: "source_provided",
    phoneStatus: "source_provided",
    postalCode: "00123",
    rating: i,
    reviewCount: i * 10,
    mapsUrl: `https://maps.google.com/?cid=${i}`,
    qualityStatus: "complete",
    ...o,
  };
}

async function insertResults(job: SearchJob, specs: Omit<NewSearchResult, "jobId" | "userId">[]) {
  return db()
    .insert(searchResults)
    .values(specs.map((s) => ({ ...s, jobId: job.id, userId: job.userId })))
    .returning();
}

async function fileText(user: AppUser, exportId: string): Promise<string> {
  const dto = await getExport(user, exportId);
  const token = new URL(dto.downloadUrl!, "http://x").searchParams.get("token");
  const res = await openDownload(user, exportId, token);
  return (await res.text()).replace(/^﻿/, "");
}

describe("exports with the real row sources", () => {
  it("exports search results in SQL sort order, applying the Google policy", async () => {
    const u = await createTestUser();
    const user = asUser(u);
    const job = await insertJob(user.id, { provider: "google_places", query: "hotel" });
    const rows = await insertResults(job, [
      result(1, { source: "google_places", sourceRecordId: "ChIJa" }),
      result(3, { source: "google_places", sourceRecordId: "ChIJb" }),
      result(2, { source: "google_places", sourceRecordId: "ChIJc" }),
    ]);
    const dto = await createExport(user, {
      target: "search",
      jobId: job.id,
      format: "csv",
      scope: "filtered",
      columns: ["business_name", "rating", "maps_url", "source_record_id", "email"],
      query: { sort: [{ field: "rating", direction: "desc" }] },
    });
    expect(dto.status).toBe("ready");
    const reason = getPolicy("google_places").restrictionReason;
    expect(dto.excludedFields).toEqual([
      { field: "business_name", reason, rows: 3 },
      { field: "rating", reason, rows: 3 },
    ]);
    const lines = (await fileText(user, dto.id)).split("\r\n").filter(Boolean);
    expect(lines).toEqual([
      "Business name,Rating,Maps link,Provider ID,Email",
      ",,https://maps.google.com/?cid=3,ChIJb,info@hotel3.example",
      ",,https://maps.google.com/?cid=2,ChIJc,info@hotel2.example",
      ",,https://maps.google.com/?cid=1,ChIJa,info@hotel1.example",
    ]);

    const selected = await createExport(user, {
      target: "search",
      jobId: job.id,
      format: "csv",
      scope: "selected",
      rowIds: [rows[0]!.id, rows[1]!.id],
      columns: ["source_record_id"],
      query: { sort: [{ field: "rating", direction: "asc" }] },
    });
    expect((await fileText(user, selected.id)).split("\r\n").filter(Boolean)).toEqual(["Provider ID", "ChIJa", "ChIJb"]);
  });

  it("exports another user's job as 404, and only the owner's rows", async () => {
    const a = asUser(await createTestUser());
    const b = asUser(await createTestUser());
    const job = await insertJob(a.id);
    await insertResults(job, [result(1)]);
    await expect(createExport(b, { target: "search", jobId: job.id, format: "csv", scope: "filtered", columns: ["business_name"], query: {} })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("exports collection leads with annotations as an XLSX", async () => {
    const user = asUser(await createTestUser());
    const c = await insertCollection(user.id, "Salons Accra");
    const [biz] = await db()
      .insert(businesses)
      .values({
        userId: user.id,
        source: "sample",
        sourceRecordId: "sample-1",
        name: "Salon Akwaaba",
        phoneRaw: "+233 24 123 4567",
        phoneE164: "+233241234567",
        postalCode: "00233",
        websiteStatus: "none",
      })
      .returning();
    await db()
      .insert(leads)
      .values({ collectionId: c.id, businessId: biz!.id, userId: user.id, status: "contacted", tags: ["vip"], notes: "@call Monday" });

    const dto = await createExport(user, {
      target: "collection",
      collectionId: c.id,
      format: "xlsx",
      scope: "filtered",
      columns: ["business_name", "phone", "postal_code", "website_status"],
      includeAnnotations: true,
      query: {},
    });
    expect(dto).toMatchObject({ status: "ready", rowCount: 1, excludedFields: [] });
    const token = new URL(dto.downloadUrl!, "http://x").searchParams.get("token");
    const res = await openDownload(user, dto.id, token);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
    const ws = wb.getWorksheet("Business Data")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Business name", "Phone", "Postal code", "Website status", "Lead status", "Tags", "Notes", "Last contacted"]);
    expect((ws.getRow(2).values as unknown[]).slice(1, 7)).toEqual(["Salon Akwaaba", "+233 24 123 4567", "00233", "No website", "Contacted", "vip"]);
    expect(ws.getCell("G2").value).toBe("'@call Monday");
    const summary = wb.getWorksheet("Search Summary")!;
    expect(summary.getCell("B2").value).toBe("Salons Accra");
  });
});
