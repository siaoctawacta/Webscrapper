import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import type { CostEstimate, SearchJobDto } from "@/lib/api-types";
import { closeDb, db } from "@/server/db";
import { auditLogs, jobEvents, rateLimits, searchJobs, searchResults, usageLogs, userSettings } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { MAP_VIEW_NEEDS_QUERY_MESSAGE } from "@/server/maps-link";
import { createTestUser, type TestUser } from "../../../../../tests/helpers/auth";
import { resetDb } from "../../../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../../../tests/helpers/request";
import { insertJob, insertResults } from "@/server/search/test-fixtures";
import { GET as listRoute, POST as createRoute } from "./route";
import { POST as estimateRoute } from "./estimate/route";
import { DELETE as deleteRoute, GET as getRoute } from "./[id]/route";
import { POST as cancelRoute } from "./[id]/cancel/route";

const { enqueueMock, resolveMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(async (_name: string, _data: unknown, _opts?: unknown): Promise<string | null> => "pgboss-job-1"),
  resolveMock: vi.fn(),
}));

vi.mock("@/server/queue", () => ({
  QUEUES: { searchRun: "search.run", exportRun: "export.run", maintenance: "maintenance.cleanup" },
  enqueue: enqueueMock,
  getBoss: vi.fn(),
  stopBoss: vi.fn(),
}));

vi.mock("@/server/maps-link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/maps-link")>();
  resolveMock.mockImplementation(actual.resolveMapsLink);
  return { ...actual, resolveMapsLink: resolveMock };
});

const SEARCH_LINK = "https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z/data=!3m1!4b1";
const PLACE_LINK = "https://www.google.com/maps/place/H%C3%B4tel+Sarakawa/@6.1226,1.2546,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d6.1226!4d1.2546";
const MAP_VIEW_LINK = "https://www.google.com/maps/@6.1433903,1.1657635,14z";

const ENV_KEYS = [
  "GOOGLE_MAPS_API_KEY",
  "COST_CONFIRM_THRESHOLD_USD",
  "MAX_CONCURRENT_JOBS_PER_USER",
  "MAX_SEARCH_JOBS_PER_USER_PER_DAY",
  "MAX_RESULTS_PER_SEARCH",
  "MONTHLY_PROVIDER_REQUEST_LIMIT_PER_USER",
] as const;
const savedEnv: Record<string, string | undefined> = {};
const setEnv = (vars: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  Object.assign(process.env, vars);
  resetEnvCache();
};

let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  await resetDb();
  enqueueMock.mockClear();
  resolveMock.mockClear();
  alice = await createTestUser();
  bob = await createTestUser();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetEnvCache();
});
afterAll(closeDb);

const noParams = () => ctx({});
const create = (u: TestUser, body: unknown, headers?: Record<string, string>) =>
  createRoute(apiRequest("/api/v1/search-jobs", { method: "POST", body, user: u, headers }), noParams());
const estimate = (u: TestUser, body: unknown) => estimateRoute(apiRequest("/api/v1/search-jobs/estimate", { method: "POST", body, user: u }), noParams());
const list = (u: TestUser, qs = "") => listRoute(apiRequest(`/api/v1/search-jobs${qs}`, { user: u }), noParams());
const getJob = (u: TestUser, id: string) => getRoute(apiRequest(`/api/v1/search-jobs/${id}`, { user: u }), ctx({ id }));
const cancel = (u: TestUser, id: string) => cancelRoute(apiRequest(`/api/v1/search-jobs/${id}/cancel`, { method: "POST", user: u }), ctx({ id }));
const del = (u: TestUser, id: string) => deleteRoute(apiRequest(`/api/v1/search-jobs/${id}`, { method: "DELETE", user: u }), ctx({ id }));

type ErrorBody = { error: { code: string; message: string; details?: unknown } };
const errorOf = async (res: Response) => ((await res.json()) as ErrorBody).error;
const jobsOf = (userId: string) => db().select().from(searchJobs).where(eq(searchJobs.userId, userId));

describe("POST /api/v1/search-jobs", () => {
  it("creates a keyword search: geocodes the location, queues the job, audits and logs the first event", async () => {
    const res = await create(alice, { query: "hôtel", location: "Lomé, Togo", targetCount: 100 });
    expect(res.status).toBe(201);
    const job = (await res.json()) as SearchJobDto;
    expect(job).toMatchObject({
      kind: "keyword",
      query: "hôtel",
      provider: "sample",
      targetCount: 100,
      enrich: true,
      status: "queued",
      sourceUrl: null,
      resultsPurged: false,
      counts: { total: 0, withWebsite: 0, withoutWebsite: 0, withEmail: 0, withPhone: 0 },
    });
    expect(job.location.label).toMatch(/Lomé/);
    expect(job.location.viewport).toBeDefined();
    expect(job.progress.phase).toBe("queued");
    expect(job.estimatedRequests).toBe(5);
    expect(job.estimatedCostUsd).toBe(0);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith("search.run", { jobId: job.id }, { expireInSeconds: 6 * 3600 });
    const [stored] = await jobsOf(alice.id);
    expect(stored!.queueJobId).toBe("pgboss-job-1");

    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "search.create"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: alice.id, resourceId: job.id, outcome: "success" });

    const events = await db().select().from(jobEvents).where(eq(jobEvents.jobId, job.id));
    expect(events.map((e) => e.type)).toEqual(["created"]);

    // The (free) sample geocode is recorded against the job.
    const usage = await db().select().from(usageLogs).where(eq(usageLogs.userId, alice.id));
    expect(usage).toMatchObject([{ operation: "geocode", billable: false, jobId: job.id, provider: "sample" }]);
  });

  it("reads a Google Maps search link (query + map area); a typed query wins", async () => {
    const res = await create(alice, { mapsUrl: SEARCH_LINK, targetCount: 60, enrich: false });
    expect(res.status).toBe(201);
    const job = (await res.json()) as SearchJobDto;
    expect(job).toMatchObject({ kind: "maps_search_link", query: "hôtel", sourceUrl: SEARCH_LINK, enrich: false });
    expect(job.location.center).toEqual({ lat: 6.1433903, lng: 1.1657635 });
    expect(job.location.viewport).toBeDefined();

    const typed = (await (await create(alice, { mapsUrl: SEARCH_LINK, query: "restaurant", targetCount: 20 })).json()) as SearchJobDto;
    expect(typed.query).toBe("restaurant");
  });

  it("creates a single-result job for a place link", async () => {
    const res = await create(alice, { mapsUrl: PLACE_LINK, targetCount: 500 });
    expect(res.status).toBe(201);
    const job = (await res.json()) as SearchJobDto;
    expect(job).toMatchObject({ kind: "maps_place_link", query: "Hôtel Sarakawa", targetCount: 1 });
    expect(job.location.center).toEqual({ lat: 6.1226, lng: 1.2546 });
  });

  it("needs a typed search term for a map view link", async () => {
    const res = await create(alice, { mapsUrl: MAP_VIEW_LINK, targetCount: 20 });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe(MAP_VIEW_NEEDS_QUERY_MESSAGE);

    const ok = await create(alice, { mapsUrl: MAP_VIEW_LINK, query: "pharmacie", targetCount: 20 });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ kind: "maps_search_link", query: "pharmacie" });
  });

  it("geocodes the text of a link without coordinates (e.g. a resolved short link)", async () => {
    resolveMock.mockResolvedValueOnce({
      kind: "search",
      query: "hotels in Accra",
      center: null,
      zoom: null,
      viewport: null,
      resolvedUrl: "https://www.google.com/maps/search/hotels+in+Accra",
    });
    const res = await create(alice, { mapsUrl: "https://maps.app.goo.gl/abc123", targetCount: 20 });
    expect(res.status).toBe(201);
    const job = (await res.json()) as SearchJobDto;
    expect(job).toMatchObject({ kind: "maps_search_link", query: "hotels in Accra", sourceUrl: "https://maps.app.goo.gl/abc123" });
    expect(job.location.viewport).toBeDefined();
    expect(resolveMock).toHaveBeenCalledWith("https://maps.app.goo.gl/abc123", expect.anything());
  });

  it("rejects links that are not Google Maps with the link reader's message", async () => {
    const res = await create(alice, { mapsUrl: "https://example.com/maps/search/hotel", targetCount: 20 });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toBe("That doesn't look like a Google Maps link.");
    expect(await jobsOf(alice.id)).toHaveLength(0);
  });

  it("validates the body, filters and sort with plain-language messages", async () => {
    const missing = await create(alice, { targetCount: 20 });
    expect(missing.status).toBe(422);
    expect((await errorOf(missing)).message).toMatch(/Paste a Google Maps link, or type what you are looking for and where/);

    const badFilter = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20, filters: { nope: true } });
    expect(badFilter.status).toBe(422);
    expect((await errorOf(badFilter)).message).toMatch(/Unknown filter "nope"/);

    const badSort = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20, sort: ["tags:asc"] });
    expect(badSort.status).toBe(422);

    const ok = await create(alice, {
      query: "hotel",
      location: "Lomé",
      targetCount: 20,
      filters: { has_website: false },
      sort: [{ field: "rating", direction: "desc" }],
      fields: ["business_name", "phone"],
    });
    expect(ok.status).toBe(201);
    const [stored] = await jobsOf(alice.id);
    expect(stored).toMatchObject({ filters: { has_website: false }, sort: [{ field: "rating", direction: "desc" }], fields: ["business_name", "phone"] });

    const notJson = await createRoute(
      new (await import("next/server")).NextRequest("http://localhost:3000/api/v1/search-jobs", {
        method: "POST",
        body: "{oops",
        headers: { origin: "http://localhost:3000", host: "localhost:3000", cookie: alice.cookie },
      }),
      noParams(),
    );
    expect(notJson.status).toBe(400);
  });

  it("refuses Google without an API key", async () => {
    const res = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20, provider: "google_places" });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toMatch(/Google Maps isn't set up on this server/);
  });

  it("clamps the target to the user's limit and says so in the first event", async () => {
    await db().insert(userSettings).values({ userId: alice.id, maxResultsPerSearch: 50 });
    const res = await create(alice, { query: "hotel", location: "Lomé", targetCount: 500 });
    expect(res.status).toBe(201);
    const job = (await res.json()) as SearchJobDto;
    expect(job.targetCount).toBe(50);
    const events = await db().select().from(jobEvents).where(eq(jobEvents.jobId, job.id));
    expect(events).toMatchObject([{ type: "target_clamped" }]);
    expect(events[0]!.message).toMatch(/allows up to 50 results per search.*you asked for 500/);

    setEnv({ MAX_RESULTS_PER_SEARCH: "30" });
    const viaEnv = (await (await create(bob, { query: "hotel", location: "Lomé", targetCount: 100 })).json()) as SearchJobDto;
    expect(viaEnv.targetCount).toBe(30);
  });

  it("enforces the concurrent and daily job quotas", async () => {
    setEnv({ MAX_CONCURRENT_JOBS_PER_USER: "1" });
    await insertJob(alice.id, { status: "searching" });
    const busy = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20 });
    expect(busy.status).toBe(429);
    expect(await errorOf(busy)).toMatchObject({ code: "quota_exceeded", message: expect.stringMatching(/already have a search running/) });
    // Other users are not affected.
    expect((await create(bob, { query: "hotel", location: "Lomé", targetCount: 20 })).status).toBe(201);

    setEnv({ MAX_CONCURRENT_JOBS_PER_USER: "5", MAX_SEARCH_JOBS_PER_USER_PER_DAY: "2" });
    await db().update(searchJobs).set({ status: "completed" }).where(eq(searchJobs.userId, alice.id));
    await insertJob(alice.id, { status: "completed" });
    const daily = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20 });
    expect(daily.status).toBe(429);
    expect((await errorOf(daily)).message).toMatch(/limit of 2 searches in 24 hours/);
    // A request refused by a quota spends nothing.
    expect(await db().select().from(usageLogs).where(eq(usageLogs.userId, alice.id))).toHaveLength(0);
  });

  it("enforces the monthly request allowance for Google, never for sample data", async () => {
    setEnv({ GOOGLE_MAPS_API_KEY: "test-key-not-real" });
    await db().insert(userSettings).values({ userId: alice.id, monthlyRequestLimit: 100 });
    const res = await create(alice, { mapsUrl: SEARCH_LINK, targetCount: 2000, confirm: true });
    expect(res.status).toBe(429);
    const err = await errorOf(res);
    expect(err.code).toBe("quota_exceeded");
    expect(err.message).toMatch(/needs about 164 Google requests, but only 100 of your 100 monthly requests are left/);

    // Usage so far counts: 90 used + 1 page (20 results) fits exactly within 100? 90 + 1 = 91 ≤ 100.
    await db().insert(usageLogs).values({ userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 90, billable: true });
    expect((await create(alice, { mapsUrl: SEARCH_LINK, targetCount: 20 })).status).toBe(201);

    // The sample provider is free and never blocked by the allowance.
    await db().insert(usageLogs).values({ userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 500, billable: true });
    const sample = await create(alice, { mapsUrl: SEARCH_LINK, targetCount: 2000, provider: "sample" });
    expect(sample.status).toBe(201);
    expect(await sample.json()).toMatchObject({ provider: "sample" });
  });

  it("rate-limits job creation", async () => {
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await db().insert(rateLimits).values({ key: `search-create:${alice.id}`, windowStart, count: 10 });
    const res = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20 });
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe("rate_limited");
  });

  it("asks for confirmation above the cost threshold, then creates the job when confirmed", async () => {
    setEnv({ GOOGLE_MAPS_API_KEY: "test-key-not-real", MONTHLY_PROVIDER_REQUEST_LIMIT_PER_USER: "0" });
    const res = await create(alice, { mapsUrl: SEARCH_LINK, targetCount: 20000 });
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect(err.code).toBe("confirmation_required");
    expect(err.message).toMatch(/could cost about \$\d+\.\d\d on your Google Cloud bill/);
    const est = (err.details as { estimate: CostEstimate }).estimate;
    expect(est).toMatchObject({ provider: "google_places", isSample: false, requiresConfirmation: true });
    expect(est.estimatedCostUsd).toBeGreaterThan(5);
    expect(await jobsOf(alice.id)).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();

    const confirmed = await create(alice, { mapsUrl: SEARCH_LINK, targetCount: 20000, confirm: true });
    expect(confirmed.status).toBe(201);
    const job = (await confirmed.json()) as SearchJobDto;
    expect(job).toMatchObject({ provider: "google_places", targetCount: 20000, estimatedRequests: est.estimatedRequests });
    expect(job.estimatedCostUsd).toBeCloseTo(est.estimatedCostUsd, 4);

    // A raised threshold needs no confirmation.
    setEnv({ COST_CONFIRM_THRESHOLD_USD: "1000" });
    expect((await create(bob, { mapsUrl: SEARCH_LINK, targetCount: 20000 })).status).toBe(201);
  });

  it("returns the existing job for a repeated Idempotency-Key", async () => {
    const body = { query: "hotel", location: "Lomé", targetCount: 20 };
    const first = await create(alice, body, { "Idempotency-Key": "form-123" });
    expect(first.status).toBe(201);
    const again = await create(alice, body, { "Idempotency-Key": "form-123" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as SearchJobDto).id).toBe(((await first.json()) as SearchJobDto).id);
    expect(await jobsOf(alice.id)).toHaveLength(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    // Keys are per user.
    expect((await create(bob, body, { "Idempotency-Key": "form-123" })).status).toBe(201);
    const tooLong = await create(alice, body, { "Idempotency-Key": "k".repeat(101) });
    expect(tooLong.status).toBe(422);
  });

  it("removes the job and reports a clear error when the queue is down", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const res = await create(alice, { query: "hotel", location: "Lomé", targetCount: 20 });
    expect(res.status).toBe(500);
    expect((await errorOf(res)).message).toMatch(/background worker queue is unavailable/);
    expect(await jobsOf(alice.id)).toHaveLength(0);
  });

  it("requires a signed-in, approved user", async () => {
    const res = await createRoute(apiRequest("/api/v1/search-jobs", { method: "POST", body: { query: "x", location: "y", targetCount: 1 } }), noParams());
    expect(res.status).toBe(401);
    const pending = await createTestUser({ status: "pending" });
    expect((await create(pending, { query: "x", location: "y", targetCount: 1 })).status).toBe(403);
  });
});

describe("POST /api/v1/search-jobs/estimate", () => {
  it("estimates a sample search without creating anything", async () => {
    const res = await estimate(alice, { query: "hôtel", location: "Lomé, Togo", targetCount: 1000 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CostEstimate & { locationLabel: string; targetCount: number };
    expect(body).toMatchObject({ provider: "sample", isSample: true, estimatedCostUsd: 0, requiresConfirmation: false, estimatedRequests: 50, targetCount: 1000 });
    expect(body.locationLabel).toMatch(/Lomé/);
    expect(await jobsOf(alice.id)).toHaveLength(0);
    expect(await db().select().from(usageLogs)).toHaveLength(0);
  });

  it("flags expensive Google searches and never geocodes (no billable request)", async () => {
    setEnv({ GOOGLE_MAPS_API_KEY: "test-key-not-real" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await estimate(alice, { query: "hôtel", location: "Lomé, Togo", targetCount: 20000 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CostEstimate & { locationLabel: string };
    expect(body).toMatchObject({ provider: "google_places", requiresConfirmation: true, locationLabel: "Lomé, Togo" });
    expect(body.notes.join(" ")).toMatch(/monthly/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reports the clamped target and link errors", async () => {
    await db().insert(userSettings).values({ userId: alice.id, maxResultsPerSearch: 100 });
    const res = await estimate(alice, { mapsUrl: SEARCH_LINK, targetCount: 5000 });
    const body = (await res.json()) as CostEstimate & { targetCount: number; kind: string };
    expect(body).toMatchObject({ targetCount: 100, kind: "maps_search_link" });
    expect(body.notes.join(" ")).toMatch(/allows up to 100 results per search/);

    const place = (await (await estimate(alice, { mapsUrl: PLACE_LINK, targetCount: 5000 })).json()) as { targetCount: number };
    expect(place.targetCount).toBe(1);

    const bad = await estimate(alice, { mapsUrl: "https://www.google.com/search?q=hotel", targetCount: 20 });
    expect(bad.status).toBe(422);
  });
});

describe("GET /api/v1/search-jobs", () => {
  it("lists the user's own jobs newest first with counts, 20 per page", async () => {
    const jobs = [];
    for (let i = 0; i < 22; i++) {
      jobs.push(await insertJob(alice.id, { status: "completed", query: `q${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }));
    }
    await insertJob(bob.id, { status: "completed", query: "bob's" });
    await insertResults(jobs[21]!, [
      { websiteStatus: "none", phoneRaw: "+228 90 00 00 01" },
      { websiteStatus: "present", websiteUrl: "https://a.example", primaryEmail: "a@a.example" },
      { websiteStatus: "unreachable", websiteUrl: "https://b.example" },
    ]);

    const res = await list(alice);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: SearchJobDto[]; total: number; pageSize: number };
    expect(body.total).toBe(22);
    expect(body.pageSize).toBe(20);
    expect(body.jobs).toHaveLength(20);
    expect(body.jobs[0]!.query).toBe("q21");
    expect(body.jobs.map((j) => j.query)).not.toContain("bob's");
    expect(body.jobs[0]!.counts).toEqual({ total: 3, withWebsite: 2, withoutWebsite: 1, withEmail: 1, withPhone: 1 });
    expect(body.jobs[1]!.counts).toEqual({ total: 0, withWebsite: 0, withoutWebsite: 0, withEmail: 0, withPhone: 0 });

    const page2 = (await (await list(alice, "?page=2")).json()) as { jobs: SearchJobDto[] };
    expect(page2.jobs.map((j) => j.query)).toEqual(["q1", "q0"]);
    expect((await list(alice, "?page=0")).status).toBe(422);
  });
});

describe("GET/DELETE /api/v1/search-jobs/{id} and cancel", () => {
  it("returns a job with counts; other users and bad ids get 404", async () => {
    const job = await insertJob(alice.id, { status: "completed" });
    await insertResults(job, [{ websiteStatus: "none" }, { websiteStatus: "present", primaryEmail: "x@y.example" }]);
    const res = await getJob(alice, job.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: job.id, status: "completed", counts: { total: 2, withWebsite: 1, withoutWebsite: 1, withEmail: 1 } });

    expect((await getJob(bob, job.id)).status).toBe(404);
    expect((await getJob(alice, "not-a-uuid")).status).toBe(404);
    expect((await getJob(alice, "7f0c5b3e-1111-4c1c-9a1a-111111111111")).status).toBe(404);
  });

  it("cancels a queued job at once and asks a running job to stop", async () => {
    const queued = await insertJob(alice.id);
    const res = await cancel(alice, queued.id);
    expect(res.status).toBe(200);
    const dto = (await res.json()) as SearchJobDto;
    expect(dto).toMatchObject({ status: "cancelled", stopReason: "Stopped before it started." });
    expect(dto.finishedAt).not.toBeNull();

    const running = await insertJob(alice.id, { status: "enriching" });
    const r2 = (await (await cancel(alice, running.id)).json()) as SearchJobDto;
    expect(r2.status).toBe("enriching");
    const [stored] = await db().select().from(searchJobs).where(eq(searchJobs.id, running.id));
    expect(stored!.cancelRequested).toBe(true);

    const done = await insertJob(alice.id, { status: "completed" });
    expect(((await (await cancel(alice, done.id)).json()) as SearchJobDto).status).toBe("completed");

    expect((await cancel(bob, running.id)).status).toBe(404);
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "search.cancel")).orderBy(asc(auditLogs.id));
    expect(audits.map((a) => a.resourceId)).toEqual([queued.id, running.id]);
  });

  it("deletes a job and its results; other users cannot", async () => {
    const job = await insertJob(alice.id, { status: "completed" });
    await insertResults(job, [{}, {}]);
    expect((await del(bob, job.id)).status).toBe(404);
    expect(await jobsOf(alice.id)).toHaveLength(1);

    const res = await del(alice, job.id);
    expect(res.status).toBe(204);
    expect(await jobsOf(alice.id)).toHaveLength(0);
    const [{ n }] = (await db().select({ n: sql<number>`count(*)::int` }).from(searchResults)) as [{ n: number }];
    expect(n).toBe(0);
    const [audit] = await db().select().from(auditLogs).where(and(eq(auditLogs.action, "search.delete"), eq(auditLogs.resourceId, job.id)));
    expect(audit!.metadata).toMatchObject({ results: 2 });
    expect((await del(alice, job.id)).status).toBe(404);
  });
});

describe("POST /api/v1/search-jobs — spending", () => {
  it("refuses an over-budget Google keyword search before paying for geocoding", async () => {
    setEnv({ GOOGLE_MAPS_API_KEY: "test-key-not-real" });
    await db().insert(userSettings).values({ userId: alice.id, monthlyRequestLimit: 10 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await create(alice, { query: "hôtel", location: "Lomé, Togo", targetCount: 1000, confirm: true });
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe("quota_exceeded");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(await db().select().from(usageLogs)).toHaveLength(0);
  });
});
