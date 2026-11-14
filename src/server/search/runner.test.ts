import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db";
import { jobEvents, searchJobs, searchResults, usageLogs, userSettings } from "@/server/db/schema";
import type { EnrichmentResult, EnrichOptions } from "@/server/enrichment";
import { ProviderError, type ProviderPlace } from "@/server/providers/types";
import { createTestUser, type TestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { runSearchJob } from "./runner";
import { enrichmentResult, fakePlace, fakeProvider, insertJob, page } from "./test-fixtures";

let user: TestUser;

beforeEach(async () => {
  await resetDb();
  user = await createTestUser();
});
afterAll(closeDb);

const places = (from: number, to: number, o: (i: number) => Partial<ProviderPlace> = () => ({})) =>
  Array.from({ length: to - from }, (_, k) => fakePlace(from + k, o(from + k)));

const loadJob = async (id: string) => (await db().select().from(searchJobs).where(eq(searchJobs.id, id)))[0]!;
const loadRows = (jobId: string) => db().select().from(searchResults).where(eq(searchResults.jobId, jobId)).orderBy(asc(searchResults.position));
const loadEvents = (jobId: string) => db().select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(asc(jobEvents.id));
const usageFor = (jobId: string) => db().select().from(usageLogs).where(eq(usageLogs.jobId, jobId));

const noEnrich = async (): Promise<EnrichmentResult> => {
  throw new Error("enrich must not be called");
};

describe("runSearchJob — searching", () => {
  it("de-duplicates across tiles, trims to the target and keeps positions increasing", async () => {
    const job = await insertJob(user.id, { targetCount: 25, enrich: false });
    const provider = fakeProvider({
      isSample: true,
      pages: [page(places(0, 20), { tilesDone: 1, tilesTotal: 4 }), page(places(15, 35), { tilesDone: 2, tilesTotal: 4 }), page(places(35, 55))],
    });
    await runSearchJob(job.id, { provider, enrich: noEnrich });

    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.stopReason).toBe("Found the 25 results you asked for.");
    expect(done.error).toBeNull();
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    // Sample retention is 30 days.
    expect(done.resultsExpireAt!.getTime() - done.finishedAt!.getTime()).toBe(30 * 24 * 3600 * 1000);
    expect(done.progress).toMatchObject({ phase: "done", unique: 25, found: 40, requests: 2, tilesDone: 2, tilesTotal: 4 });
    expect(done.actualRequests).toBe(2);

    const rows = await loadRows(job.id);
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((r) => r.sourceRecordId)).size).toBe(25);
    expect(rows.map((r) => r.position)).toEqual([...rows.map((r) => r.position)].sort((a, b) => a - b));
    expect(rows[0]).toMatchObject({ source: "sample", userId: user.id, name: "Hôtel Test 000", phoneE164: "+22890123000", websiteStatus: "none" });
    // Only the pages needed were requested: the third page was never asked for.
    expect(provider.plans[0]).toMatchObject({ query: "hôtel", targetCount: 25 });

    const usage = await usageFor(job.id);
    expect(usage.reduce((n, u) => n + u.requestCount, 0)).toBe(2);
    expect(usage.every((u) => !u.billable && u.userId === user.id && u.provider === "sample" && u.operation === "text_search")).toBe(true);

    const events = (await loadEvents(job.id)).map((e) => e.type);
    expect(events[0]).toBe("started");
    expect(events).toContain("tiles");
    expect(events.at(-1)).toBe("stopped");
  });

  it("completes with an explanation when the provider has no more results for the area", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 100, enrich: false });
    const provider = fakeProvider({ pages: [page(places(0, 20)), page(places(20, 30), { exhausted: true })] });
    await runSearchJob(job.id, { provider });
    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.stopReason).toBe("Google returned all the results it has for this area (30).");
    expect(done.resultsExpireAt!.getTime() - done.finishedAt!.getTime()).toBe(24 * 3600 * 1000);
    const usage = await usageFor(job.id);
    expect(usage.every((u) => u.billable && u.provider === "google_places")).toBe(true);
    expect(usage.reduce((n, u) => n + u.requestCount, 0)).toBe(2);
    expect(usage.reduce((n, u) => n + u.estimatedCostUsd, 0)).toBeCloseTo(0.07, 4);
  });

  it("completes with zero results and a helpful message when nothing is found", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 20 });
    await runSearchJob(job.id, { provider: fakeProvider({ pages: [page([], { exhausted: true })] }) });
    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.stopReason).toMatch(/No businesses were found for “hôtel”/);
  });

  it("stops at the job's request budget and reports a partial result", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 100, enrich: false });
    const provider = fakeProvider({
      estimate: { maxRequests: 2 },
      pages: [page(places(0, 20)), page(places(20, 40)), page(places(40, 60)), page(places(60, 80))],
    });
    await runSearchJob(job.id, { provider });
    expect(provider.plans[0]!.maxRequests).toBe(2);
    const done = await loadJob(job.id);
    expect(done.status).toBe("partial");
    expect(done.stopReason).toMatch(/Stopped after 2 requests, the cost limit for this search, with 40 results found/);
    expect((await loadRows(job.id)).length).toBe(40);
  });

  it("caps the budget at the user's remaining monthly allowance", async () => {
    await db().insert(userSettings).values({ userId: user.id, monthlyRequestLimit: 3 });
    await db().insert(usageLogs).values({ userId: user.id, provider: "google_places", operation: "text_search", requestCount: 2, billable: true });
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 100, enrich: false });
    const provider = fakeProvider({ pages: [page(places(0, 20)), page(places(20, 40)), page(places(40, 60))] });
    await runSearchJob(job.id, { provider });
    expect(provider.plans[0]!.maxRequests).toBe(1);
    const done = await loadJob(job.id);
    expect(done.status).toBe("partial");
    expect(done.stopReason).toMatch(/monthly limit of 3 Google requests was reached \(20 results found\)/);
  });

  it("fails without calling the provider when the monthly allowance is used up", async () => {
    await db().insert(userSettings).values({ userId: user.id, monthlyRequestLimit: 3 });
    await db().insert(usageLogs).values({ userId: user.id, provider: "google_places", operation: "text_search", requestCount: 3, billable: true });
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 100 });
    const provider = fakeProvider({ pages: [page(places(0, 20))] });
    await runSearchJob(job.id, { provider });
    expect(provider.plans).toHaveLength(0);
    const done = await loadJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/monthly limit of 3 Google requests is used up/);
  });

  it("never applies a monthly cap to the (free) sample provider", async () => {
    await db().insert(userSettings).values({ userId: user.id, monthlyRequestLimit: 1 });
    await db().insert(usageLogs).values({ userId: user.id, provider: "google_places", operation: "text_search", requestCount: 5, billable: true });
    const job = await insertJob(user.id, { targetCount: 40, enrich: false });
    const provider = fakeProvider({ isSample: true, pages: [page(places(0, 20)), page(places(20, 40))] });
    await runSearchJob(job.id, { provider });
    expect((await loadJob(job.id)).status).toBe("completed");
  });

  it("fails with the provider's message on an auth error before any result", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 20 });
    const msg = "Google rejected the API key. Check that the key is valid and billing is enabled for the Places API.";
    const provider = fakeProvider({
      script: async function* () {
        throw new ProviderError(msg, "auth", 403);
      },
    });
    await runSearchJob(job.id, { provider });
    const done = await loadJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe(msg);
    expect(done.finishedAt).not.toBeNull();
    expect((await loadEvents(job.id)).some((e) => e.type === "error" && e.message === msg)).toBe(true);
  });

  it("keeps the results and reports partial when the provider fails mid-way", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 100, enrich: false });
    const provider = fakeProvider({
      script: async function* (s) {
        await s.bill();
        yield page(places(0, 20));
        await s.bill();
        throw new ProviderError("Google is temporarily unavailable. Try again in a few minutes.", "unavailable", 503);
      },
    });
    await runSearchJob(job.id, { provider });
    const done = await loadJob(job.id);
    expect(done.status).toBe("partial");
    expect(done.error).toBe("Google is temporarily unavailable. Try again in a few minutes.");
    expect(done.stopReason).toBe("Stopped early with 20 results: Google is temporarily unavailable. Try again in a few minutes.");
    expect((await loadRows(job.id)).length).toBe(20);
    // Both requests were recorded, including the one that failed.
    expect((await usageFor(job.id)).reduce((n, u) => n + u.requestCount, 0)).toBe(2);
  });

  it("marks the job failed (never left active) on an unexpected error", async () => {
    const job = await insertJob(user.id, { targetCount: 20 });
    const provider = fakeProvider({
      isSample: true,
      script: async function* () {
        throw new TypeError("cannot read properties of undefined");
      },
    });
    await runSearchJob(job.id, { provider });
    const done = await loadJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("Something went wrong while running this search. Please try again.");
  });

  it("stops when the user cancels mid-run and keeps what was found", async () => {
    const job = await insertJob(user.id, { targetCount: 100 });
    const provider = fakeProvider({
      isSample: true,
      script: async function* (s) {
        await s.bill();
        yield page(places(0, 20), { tilesDone: 1, tilesTotal: 5 });
        await db().update(searchJobs).set({ cancelRequested: true }).where(eq(searchJobs.id, job.id));
        const deadline = Date.now() + 3000;
        while (!s.ctx.signal?.aborted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        if (s.ctx.signal?.aborted) return;
        await s.bill();
        yield page(places(20, 40));
      },
    });
    await runSearchJob(job.id, { provider, cancelPollMs: 20, enrich: noEnrich });
    const done = await loadJob(job.id);
    expect(done.status).toBe("cancelled");
    expect(done.stopReason).toBe("Stopped by you with 20 results found.");
    expect((await loadRows(job.id)).length).toBe(20);
    expect(done.resultsExpireAt).not.toBeNull();
  });

  it("does nothing for a job that is not queued", async () => {
    const job = await insertJob(user.id, { status: "completed", stopReason: "done before" });
    const provider = fakeProvider({ isSample: true, pages: [page(places(0, 20))] });
    await runSearchJob(job.id, { provider });
    expect(provider.plans).toHaveLength(0);
    expect((await loadJob(job.id)).stopReason).toBe("done before");
    await runSearchJob("not-a-uuid", { provider });
    await runSearchJob("7f0c5b3e-1111-4c1c-9a1a-111111111111", { provider });
  });

  it("looks up a single business for a place link", async () => {
    const job = await insertJob(user.id, {
      kind: "maps_place_link",
      query: "Hôtel Sarakawa",
      targetCount: 1,
      location: { label: "Hôtel Sarakawa", center: { lat: 6.13, lng: 1.25 } },
      enrich: false,
    });
    const found = fakePlace(7, { name: "Hôtel Sarakawa" });
    const provider = fakeProvider({ findPlace: ({ name }) => (name === "Hôtel Sarakawa" ? found : null) });
    await runSearchJob(job.id, { provider });
    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.stopReason).toBe("Found the business from your link.");
    const rows = await loadRows(job.id);
    expect(rows.map((r) => r.name)).toEqual(["Hôtel Sarakawa"]);
    expect((await usageFor(job.id)).map((u) => u.operation)).toEqual(["find_place"]);
  });

  it("fails a place link that matches no business", async () => {
    const job = await insertJob(user.id, { kind: "maps_place_link", query: "Nowhere", targetCount: 1, location: { label: "Nowhere" } });
    await runSearchJob(job.id, { provider: fakeProvider({}) });
    const done = await loadJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/couldn't find this business/);
  });

  it("fails clearly when the job has no map area", async () => {
    const job = await insertJob(user.id, { location: { label: "Somewhere" } });
    await runSearchJob(job.id, { provider: fakeProvider({ isSample: true, pages: [] }) });
    const done = await loadJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/no map area/);
  });
});

describe("runSearchJob — enrichment and duplicates", () => {
  it("visits real websites with at most one request per host and stores what was found", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 5 });
    const sites = ["https://a.example/", "https://a.example/other", "https://b.example/", "https://down.example/", null];
    const provider = fakeProvider({ pages: [page(places(0, 5, (i) => ({ websiteUrl: sites[i] ?? null })), { exhausted: true })] });

    const inFlight = new Map<string, number>();
    let overlap = false;
    const calls: string[] = [];
    const enrich = async (url: string, opts?: EnrichOptions): Promise<EnrichmentResult> => {
      expect(opts?.signal).toBeInstanceOf(AbortSignal);
      const host = new URL(url).hostname;
      calls.push(url);
      inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
      if (inFlight.get(host)! > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 15));
      inFlight.set(host, inFlight.get(host)! - 1);
      if (host === "down.example") {
        return enrichmentResult({ websiteStatus: "unreachable", websiteCheck: { status: "unreachable", error: "Timed out", checkedAt: new Date().toISOString() } });
      }
      return enrichmentResult({
        emails: [{ email: `contact@${host}`, sourceUrl: `${url}contact`, sameDomain: true }],
        socials: { facebook: `https://facebook.com/${host}` },
      });
    };
    await runSearchJob(job.id, { provider, enrich, crawlConcurrency: 4 });

    expect(overlap).toBe(false);
    expect(calls.sort()).toEqual(["https://a.example/", "https://a.example/other", "https://b.example/", "https://down.example/"]);
    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.progress).toMatchObject({ enriched: 4, enrichTotal: 4, phase: "done" });

    const rows = await loadRows(job.id);
    expect(rows[0]).toMatchObject({ websiteStatus: "present", primaryEmail: "contact@a.example", emailOrigin: "website_crawl", emailStatus: "source_provided" });
    expect(rows[0]!.socials).toEqual({ facebook: "https://facebook.com/a.example" });
    expect(rows[0]!.enrichedAt).not.toBeNull();
    expect(rows[3]).toMatchObject({ websiteStatus: "unreachable", primaryEmail: null, qualityStatus: "needs_review" });
    expect(rows[3]!.qualityIssues).toContain("website_unreachable");
    expect(rows[4]).toMatchObject({ websiteStatus: "none", enrichedAt: null });

    const events = (await loadEvents(job.id)).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["started", "enrichment_started", "enrichment_done", "stopped"]));
    // The two a.example rows share a host: flagged as probable duplicates for review.
    expect(rows[1]).toMatchObject({ duplicateOfId: rows[0]!.id, qualityStatus: "duplicate_candidate" });
  });

  it("uses the sample provider's pre-computed enrichment without any network call", async () => {
    const job = await insertJob(user.id, { targetCount: 3 });
    const checkedAt = new Date().toISOString();
    const withSite = (i: number): Partial<ProviderPlace> =>
      i === 2
        ? {}
        : {
            websiteUrl: `https://site${i}.example/`,
            sampleEnrichment: {
              emails: [{ email: `info@site${i}.example`, sourceUrl: `https://site${i}.example/contact`, sameDomain: true }],
              socials: { instagram: `https://instagram.com/site${i}` },
              websiteCheck: { status: "ok", https: true, mobileViewport: true, checkedAt },
            },
          };
    const provider = fakeProvider({ isSample: true, pages: [page(places(0, 3, withSite), { exhausted: true })] });
    await runSearchJob(job.id, { provider, enrich: noEnrich });
    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.progress).toMatchObject({ enriched: 2, enrichTotal: 2 });
    const rows = await loadRows(job.id);
    expect(rows[0]).toMatchObject({ websiteStatus: "present", primaryEmail: "info@site0.example", emailStatus: "source_provided" });
    expect(rows[0]!.websiteCheck).toMatchObject({ status: "ok", https: true });
    expect(rows[2]).toMatchObject({ websiteStatus: "none", primaryEmail: null });
  });

  it("skips website visits when enrichment is off", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 2, enrich: false });
    const provider = fakeProvider({ pages: [page(places(0, 2, () => ({ websiteUrl: "https://x.example/" })), { exhausted: true })] });
    await runSearchJob(job.id, { provider, enrich: noEnrich });
    const rows = await loadRows(job.id);
    expect(rows.every((r) => r.websiteStatus === "unknown" && r.enrichedAt === null)).toBe(true);
  });

  it("flags probable duplicates (same phone) without merging them", async () => {
    const job = await insertJob(user.id, { targetCount: 3, enrich: false });
    const provider = fakeProvider({
      isSample: true,
      pages: [
        page(
          [
            fakePlace(1),
            fakePlace(2, { name: "Hotel Test One", phoneInternational: fakePlace(1).phoneInternational }),
            fakePlace(3),
          ],
          { exhausted: true },
        ),
      ],
    });
    await runSearchJob(job.id, { provider });
    const rows = await loadRows(job.id);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ duplicateOfId: rows[0]!.id, qualityStatus: "duplicate_candidate" });
    expect(rows[1]!.qualityIssues).toContain("probable_duplicate");
    expect(rows[0]!.duplicateOfId).toBeNull();
    expect(rows[2]!.duplicateOfId).toBeNull();
    expect((await loadEvents(job.id)).some((e) => e.type === "duplicates")).toBe(true);
  });

  it("stops website checks when cancelled and keeps the searched results", async () => {
    const job = await insertJob(user.id, { provider: "google_places", targetCount: 6 });
    const provider = fakeProvider({
      pages: [page(places(0, 6, (i) => ({ websiteUrl: `https://s${i}.example/` })), { exhausted: true })],
    });
    let calls = 0;
    const enrich = async (_url: string, opts?: EnrichOptions): Promise<EnrichmentResult> => {
      calls += 1;
      if (calls === 1) await db().update(searchJobs).set({ cancelRequested: true }).where(eq(searchJobs.id, job.id));
      await new Promise<void>((resolve) => {
        if (opts?.signal?.aborted) return resolve();
        opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
        setTimeout(resolve, 3000);
      });
      return enrichmentResult({ websiteCheck: { status: "skipped", error: "Cancelled", checkedAt: new Date().toISOString() } });
    };
    await runSearchJob(job.id, { provider, enrich, crawlConcurrency: 2, cancelPollMs: 20 });
    const done = await loadJob(job.id);
    expect(done.status).toBe("cancelled");
    expect(calls).toBeLessThanOrEqual(2);
    const rows = await loadRows(job.id);
    expect(rows).toHaveLength(6);
    // Interrupted visits are not stored as checks.
    expect(rows.every((r) => r.enrichedAt === null)).toBe(true);
  });

  it("stops quietly when the job is deleted while it runs", async () => {
    const job = await insertJob(user.id, { targetCount: 100 });
    const provider = fakeProvider({
      isSample: true,
      script: async function* (s) {
        yield page(places(0, 20));
        await db().delete(searchJobs).where(and(eq(searchJobs.id, job.id), eq(searchJobs.userId, user.id)));
        const deadline = Date.now() + 3000;
        while (!s.ctx.signal?.aborted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        if (!s.ctx.signal?.aborted) yield page(places(20, 40));
      },
    });
    await expect(runSearchJob(job.id, { provider, cancelPollMs: 20 })).resolves.toBeUndefined();
    expect(await db().select().from(searchJobs).where(eq(searchJobs.id, job.id))).toHaveLength(0);
  });
});

describe("runSearchJob — real sample provider", () => {
  it("runs a sample search end to end without touching the network", async () => {
    const job = await insertJob(user.id, { targetCount: 120 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await runSearchJob(job.id);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const done = await loadJob(job.id);
    expect(done.status).toBe("completed");
    expect(done.error).toBeNull();
    const rows = await loadRows(job.id);
    expect(rows).toHaveLength(120);
    expect(new Set(rows.map((r) => r.sourceRecordId)).size).toBe(120);
    const noSite = rows.filter((r) => r.websiteStatus === "none");
    expect(noSite.length).toBeGreaterThan(20);
    expect(noSite.every((r) => r.websiteUrl === null)).toBe(true);
    const withSite = rows.filter((r) => r.websiteUrl !== null);
    expect(withSite.every((r) => r.websiteStatus !== "unknown" && r.enrichedAt !== null)).toBe(true);
    const emails = rows.filter((r) => r.primaryEmail);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((r) => r.primaryEmail!.endsWith(".example") && r.emailStatus !== "verified")).toBe(true);
    expect(done.progress).toMatchObject({ phase: "done", unique: 120, enrichTotal: withSite.length, enriched: withSite.length });
  });
});

describe("runSearchJob — worker shutdown", () => {
  it("stops when the worker's signal aborts and keeps the results as a partial search", async () => {
    const job = await insertJob(user.id, { targetCount: 100 });
    const workerSignal = new AbortController();
    const provider = fakeProvider({
      isSample: true,
      script: async function* (s) {
        await s.bill();
        yield page(places(0, 20));
        workerSignal.abort();
        if (s.ctx.signal?.aborted) return;
        yield page(places(20, 40));
      },
    });
    await runSearchJob(job.id, { provider, signal: workerSignal.signal });
    const done = await loadJob(job.id);
    expect(done.status).toBe("partial");
    expect(done.error).toMatch(/^The worker stopped unexpectedly/);
    expect((await loadRows(job.id)).length).toBe(20);
  });

  it("fails a Google job whose API key was removed after it was queued", async () => {
    const job = await insertJob(user.id, { provider: "google_places" });
    await runSearchJob(job.id);
    const done = await loadJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/Google Maps isn't set up on this server any more/);
  });
});
