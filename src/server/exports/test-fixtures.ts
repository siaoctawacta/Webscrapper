/**
 * Test-only fixtures for the exports module (imported by *.test.ts files only, never by app code).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BusinessRow } from "@/lib/api-types";
import { emptyProgress, type SourceId } from "@/lib/domain";
import type { ListQuery } from "@/lib/list-query";
import { db } from "../db";
import { collections, searchJobs, type SearchJob } from "../db/schema";
import { resetEnvCache } from "../env";
import { rowValue } from "../rows";
import type { ExportTargetRef, RowSource } from "./row-source";

export function businessRow(i: number, o: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    source: "sample",
    sourceRecordId: `sample-${i}`,
    name: `Business ${String(i).padStart(3, "0")}`,
    category: "Hotel",
    categories: ["hotel"],
    phone: `+228 90 12 34 ${String(i % 100).padStart(2, "0")}`,
    phoneE164: `+228901234${String(i % 100).padStart(2, "0")}`,
    phoneStatus: "source_provided",
    website: `https://biz${i}.example/`,
    websiteHost: `biz${i}.example`,
    websiteStatus: "present",
    websiteCheck: null,
    email: `contact@biz${i}.example`,
    emails: [{ email: `contact@biz${i}.example`, sourceUrl: `https://biz${i}.example/contact`, sameDomain: true }],
    emailOrigin: "website_crawl",
    emailStatus: "source_provided",
    socials: { facebook: `https://facebook.com/biz${i}` },
    address: `${i} Boulevard du 13 Janvier, Lomé`,
    city: "Lomé",
    region: "Maritime",
    country: "Togo",
    postalCode: "00123",
    lat: 6.1319,
    lng: 1.2228,
    rating: 4.5,
    reviewCount: 10 + i,
    mapsUrl: `https://maps.google.com/?cid=${i}`,
    businessStatus: "OPERATIONAL",
    qualityStatus: "complete",
    qualityIssues: [],
    duplicateOfId: null,
    aiCategory: null,
    retrievedAt: "2026-11-14T09:30:00.000Z",
    enrichedAt: null,
    lastVerifiedAt: null,
    restrictedFields: [],
    liveFields: [],
    ...o,
  };
}

export const googleRow = (i: number, o: Partial<BusinessRow> = {}) =>
  businessRow(i, { source: "google_places", sourceRecordId: `ChIJplace${i}`, ...o });

export const withLead = (row: BusinessRow, lead: Partial<NonNullable<BusinessRow["lead"]>> = {}): BusinessRow => ({
  ...row,
  lead: {
    collectionId: "00000000-0000-4000-8000-00000000c011",
    status: "new",
    tags: [],
    notes: "",
    lastContactedAt: null,
    createdAt: "2026-11-13T08:00:00.000Z",
    updatedAt: "2026-11-13T08:00:00.000Z",
    ...lead,
  },
});

export function sortRows(rows: BusinessRow[], sort: ListQuery["sort"]): BusinessRow[] {
  if (!sort.length) return [...rows];
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const va = rowValue(a, s.field) as string | number | null;
      const vb = rowValue(b, s.field) as string | number | null;
      if (va === vb) continue;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      if (cmp !== 0) return s.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

/** In-memory row source: sorts by the query, pages like the real ones, records calls. */
export function fakeRowSource(all: BusinessRow[], opts: { maxPageSize?: number } = {}) {
  const calls: { method: "list" | "byIds"; ref: ExportTargetRef; page?: number; pageSize?: number; ids?: number }[] = [];
  const source: RowSource = {
    async list(_user, ref, query) {
      const pageSize = Math.min(query.pageSize, opts.maxPageSize ?? Number.MAX_SAFE_INTEGER);
      calls.push({ method: "list", ref, page: query.page, pageSize });
      const sorted = sortRows(all, query.sort);
      const start = (query.page - 1) * pageSize;
      return { rows: sorted.slice(start, start + pageSize), total: sorted.length, pageSize };
    },
    async byIds(_user, ref, ids, query) {
      calls.push({ method: "byIds", ref, ids: ids.length });
      const wanted = new Set(ids);
      return sortRows(
        all.filter((r) => wanted.has(r.id)),
        query.sort,
      );
    },
  };
  return { source, calls };
}

/** A temporary EXPORT_STORAGE_DIR for one test file. */
export async function useTempStorage(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadfinder-exports-"));
  process.env.EXPORT_STORAGE_DIR = dir;
  resetEnvCache();
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function insertJob(
  userId: string,
  opts: { provider?: SourceId; resultsPurgedAt?: Date | null; resultsExpireAt?: Date | null; query?: string; label?: string; city?: string } = {},
): Promise<SearchJob> {
  const [job] = await db()
    .insert(searchJobs)
    .values({
      userId,
      kind: "keyword",
      query: opts.query ?? "hôtel",
      location: { label: opts.label ?? "Lomé, Togo", city: opts.city ?? "Lomé", country: "Togo" },
      provider: opts.provider ?? "sample",
      targetCount: 100,
      status: "completed",
      progress: emptyProgress(),
      resultsPurgedAt: opts.resultsPurgedAt ?? null,
      resultsExpireAt: opts.resultsExpireAt ?? null,
    })
    .returning();
  return job!;
}

export async function insertCollection(userId: string, name = "Lomé hotels") {
  const [c] = await db().insert(collections).values({ userId, name }).returning();
  return c!;
}
