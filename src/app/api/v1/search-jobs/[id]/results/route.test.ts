import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusinessRow, ListResponse } from "@/lib/api-types";
import type { AppUser } from "@/server/auth/session";
import { closeDb } from "@/server/db";
import type { SearchJob, SearchResult } from "@/server/db/schema";
import { getSearchResultsByIds } from "@/server/search";
import { insertJob, insertResults } from "@/server/search/test-fixtures";
import { createTestUser, type TestUser } from "../../../../../../../tests/helpers/auth";
import { resetDb } from "../../../../../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../../../../../tests/helpers/request";
import { GET as resultsRoute } from "./route";
import { GET as idsRoute } from "./ids/route";
import { GET as oneRoute } from "./[resultId]/route";

const CATEGORIES = ["Hotel", "Restaurant", "Bar", null] as const;
const CITIES = ["Lomé", "Kara", "lomé"] as const;
const RATINGS = [4.5, 4, 4, null, 3.5] as const;
const N = 63;

let alice: TestUser;
let bob: TestUser;
let job: SearchJob;
let otherJob: SearchJob;
let rows: SearchResult[];
let bobRow: SearchResult;

beforeAll(async () => {
  await resetDb();
  alice = await createTestUser();
  bob = await createTestUser();
  job = await insertJob(alice.id, { status: "completed" });
  otherJob = await insertJob(alice.id, { status: "completed" });
  rows = await insertResults(
    job,
    Array.from({ length: N }, (_, i) => {
      const hasSite = i % 3 !== 0;
      return {
        sourceRecordId: `p-${i}`,
        name: i === 7 ? "Salon Élégance" : `Business ${String(i).padStart(2, "0")}`,
        category: CATEGORIES[i % 4],
        city: CITIES[i % 3],
        rating: RATINGS[i % 5],
        reviewCount: i % 7,
        phoneRaw: i % 5 === 0 ? null : `+228 90 00 ${String(10 + i).padStart(2, "0")} 00`,
        phoneE164: i % 5 === 0 ? null : `+2289000${String(10 + i).padStart(2, "0")}00`,
        phoneDigits: i % 5 === 0 ? null : `2289000${String(10 + i).padStart(2, "0")}00`,
        websiteUrl: hasSite ? `https://biz${i}.example/` : null,
        websiteHost: hasSite ? `biz${i}.example` : null,
        websiteStatus: !hasSite ? "none" : i % 3 === 1 ? "present" : "unreachable",
        primaryEmail: i % 4 === 1 ? `info@biz${i}.example` : null,
        qualityStatus: i === 10 ? "duplicate_candidate" : "complete",
        address: `${i} Avenue de la Libération`,
      } as const;
    }),
  );
  await insertResults(otherJob, [{ sourceRecordId: "other-1", name: "Other job row" }]);
  const bobJob = await insertJob(bob.id, { status: "completed" });
  bobRow = (await insertResults(bobJob, [{ sourceRecordId: "bob-1", name: "Bob row" }]))[0]!;
});
afterAll(closeDb);

const asAppUser = (u: TestUser): AppUser => ({ id: u.id, name: "x", email: u.email, role: "member", status: "active" });

const get = (u: TestUser, jobId: string, qs = "") => resultsRoute(apiRequest(`/api/v1/search-jobs/${jobId}/results${qs ? `?${qs}` : ""}`, { user: u }), ctx({ id: jobId }));
const getIds = (u: TestUser, jobId: string, qs = "") =>
  idsRoute(apiRequest(`/api/v1/search-jobs/${jobId}/results/ids${qs ? `?${qs}` : ""}`, { user: u }), ctx({ id: jobId }));
const getOne = (u: TestUser, jobId: string, resultId: string) =>
  oneRoute(apiRequest(`/api/v1/search-jobs/${jobId}/results/${resultId}`, { user: u }), ctx({ id: jobId, resultId }));

const body = async (res: Response) => {
  expect(res.status).toBe(200);
  return (await res.json()) as ListResponse;
};

/** Reference ordering: nulls last in both directions, then position. */
function cmp(a: SearchResult, b: SearchResult, keys: { get: (r: SearchResult) => string | number | null; desc?: boolean }[]) {
  for (const k of keys) {
    const va = k.get(a);
    const vb = k.get(b);
    if (va === vb) continue;
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = va < vb ? -1 : 1;
    return k.desc ? -c : c;
  }
  return a.position - b.position;
}

async function allPages(u: TestUser, qs: string, pageSize = 25) {
  const seen: BusinessRow[] = [];
  let total = 0;
  for (let p = 1; p < 20; p++) {
    const b = await body(await get(u, job.id, `${qs}&page=${p}&page_size=${pageSize}`));
    total = b.total;
    seen.push(...b.rows);
    if (b.rows.length < pageSize) break;
  }
  return { seen, total };
}

describe("GET /api/v1/search-jobs/{id}/results", () => {
  it("returns the first page in provider order with total, facets and the source policy", async () => {
    const b = await body(await get(alice, job.id));
    expect(b.total).toBe(N);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(50);
    expect(b.rows).toHaveLength(50);
    expect(b.rows.slice(0, 3).map((r) => r.name)).toEqual(["Business 00", "Business 01", "Business 02"]);
    expect(b.rows[1]).toMatchObject({ source: "sample", website: "https://biz1.example/", websiteStatus: "present", email: "info@biz1.example" });
    expect(b.policies).toHaveLength(1);
    expect(b.policies[0]).toMatchObject({ source: "sample", isSample: true });
    // Facets cover every row of the job, sorted by count.
    const cat = Object.fromEntries(b.facets.categories.map((f) => [f.value, f.count]));
    expect(cat).toEqual({ Hotel: 16, Restaurant: 16, Bar: 16 });
    expect(b.facets.categories.find((f) => f.value === null as unknown as string)).toBeUndefined();
    const ws = Object.fromEntries(b.facets.websiteStatus.map((f) => [f.value, f.count]));
    expect(ws).toEqual({ none: 21, present: 21, unreachable: 21 });
    expect(b.facets.cities.reduce((n, f) => n + f.count, 0)).toBe(N);
  });

  it("keeps facets independent of the user's filters", async () => {
    const all = await body(await get(alice, job.id));
    const filtered = await body(await get(alice, job.id, "filter[has_website]=false&filter[category]=Hotel"));
    expect(filtered.facets).toEqual(all.facets);
    expect(filtered.total).toBeLessThan(all.total);
  });

  it("sorts by several keys with nulls last and position as the tie-breaker", async () => {
    const { seen, total } = await allPages(alice, "sort=category:asc&sort=rating:desc", 25);
    expect(total).toBe(N);
    const expected = [...rows]
      .sort((a, b) =>
        cmp(a, b, [
          { get: (r) => r.category?.toLowerCase() ?? null },
          { get: (r) => r.rating, desc: true },
        ]),
      )
      .map((r) => r.id);
    expect(seen.map((r) => r.id)).toEqual(expected);
  });

  it("pages through ties without duplicates or omissions", async () => {
    for (const qs of ["sort=rating:asc", "sort=website_status:desc&sort=city:asc", "sort=review_count:desc"]) {
      const { seen, total } = await allPages(alice, qs, 25);
      expect(total).toBe(N);
      expect(seen).toHaveLength(N);
      expect(new Set(seen.map((r) => r.id)).size).toBe(N);
    }
  });

  it("applies filters", async () => {
    const noSite = await body(await get(alice, job.id, "filter[has_website]=false&page_size=100"));
    expect(noSite.total).toBe(21);
    expect(noSite.rows.every((r) => r.websiteStatus === "none")).toBe(true);

    const cats = await body(await get(alice, job.id, "filter[category]=Hotel&filter[category]=Bar&page_size=100"));
    expect(cats.total).toBe(32);
    expect(new Set(cats.rows.map((r) => r.category))).toEqual(new Set(["Hotel", "Bar"]));

    const rated = await body(await get(alice, job.id, "filter[min_rating]=4&filter[has_email]=true&page_size=100"));
    expect(rated.rows.length).toBeGreaterThan(0);
    expect(rated.rows.every((r) => (r.rating ?? 0) >= 4 && r.email !== null)).toBe(true);

    // City filter is case-insensitive.
    const lome = await body(await get(alice, job.id, "filter[city]=LOMÉ&page_size=100"));
    expect(lome.total).toBe(42);

    const noDupes = await body(await get(alice, job.id, "filter[hide_duplicates]=true&page_size=100"));
    expect(noDupes.total).toBe(N - 1);
  });

  it("supports quick search across name, phone digits and website", async () => {
    const byName = await body(await get(alice, job.id, "search=élégance"));
    expect(byName.rows.map((r) => r.name)).toEqual(["Salon Élégance"]);
    const byPhone = await body(await get(alice, job.id, `search=${encodeURIComponent("90 00 21")}`));
    expect(byPhone.rows.map((r) => r.name)).toEqual(["Business 11"]);
    const bySite = await body(await get(alice, job.id, "search=biz62.example"));
    expect(bySite.rows.map((r) => r.name)).toEqual(["Business 62"]);
    // LIKE wildcards in user text are literal.
    expect((await body(await get(alice, job.id, "search=%25"))).total).toBe(0);
  });

  it("rejects unknown sorts and filters with 422", async () => {
    for (const qs of ["sort=tags:asc", "sort=maps_url:asc", "sort=name:sideways", "filter[nope]=1", "filter[lead_status]=new", "page_size=7", "page=0", "filter[min_rating]=9"]) {
      const res = await get(alice, job.id, qs);
      expect(res.status, qs).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_failed");
    }
  });

  it("returns 404 for another user's job or an unknown id", async () => {
    expect((await get(bob, job.id)).status).toBe(404);
    expect((await get(alice, "7f0c5b3e-1111-4c1c-9a1a-111111111111")).status).toBe(404);
    expect((await get(alice, "nope")).status).toBe(404);
    expect((await getIds(bob, job.id)).status).toBe(404);
  });
});

describe("GET /api/v1/search-jobs/{id}/results/ids", () => {
  it("returns every matching id in the grid's sort order", async () => {
    const res = await getIds(alice, job.id, "sort=rating:desc&filter[has_website]=true");
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ids: string[]; total: number; truncated: boolean };
    expect(b.total).toBe(42);
    expect(b.truncated).toBe(false);
    const { seen } = await allPages(alice, "sort=rating:desc&filter[has_website]=true", 25);
    expect(b.ids).toEqual(seen.map((r) => r.id));
  });
});

describe("GET /api/v1/search-jobs/{id}/results/{resultId}", () => {
  it("returns one owned result and 404 otherwise", async () => {
    const res = await getOne(alice, job.id, rows[7]!.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: rows[7]!.id, name: "Salon Élégance" });
    expect((await getOne(alice, otherJob.id, rows[7]!.id)).status).toBe(404);
    expect((await getOne(bob, job.id, rows[7]!.id)).status).toBe(404);
    expect((await getOne(alice, job.id, bobRow.id)).status).toBe(404);
    expect((await getOne(alice, job.id, "zzz")).status).toBe(404);
  });
});

describe("getSearchResultsByIds", () => {
  it("returns owned rows in the requested sort order and skips foreign ids", async () => {
    const pick = [rows[5]!, rows[1]!, rows[40]!, rows[12]!];
    const got = await getSearchResultsByIds(asAppUser(alice), job.id, [...pick.map((r) => r.id), bobRow.id, "garbage"], {
      sort: [{ field: "business_name", direction: "desc" }],
    });
    expect(got.map((r) => r.name)).toEqual(["Business 40", "Business 12", "Business 05", "Business 01"]);
    const byPosition = await getSearchResultsByIds(asAppUser(alice), job.id, pick.map((r) => r.id));
    expect(byPosition.map((r) => r.name)).toEqual(["Business 01", "Business 05", "Business 12", "Business 40"]);
    await expect(getSearchResultsByIds(asAppUser(bob), job.id, [rows[1]!.id])).rejects.toMatchObject({ code: "not_found" });
  });
});
