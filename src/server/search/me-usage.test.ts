import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { GET as usageRoute } from "@/app/api/v1/usage/route";
import type { MeResponse } from "@/lib/api-types";
import { closeDb, db } from "@/server/db";
import { usageLogs, userSettings } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { createTestUser, type TestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../tests/helpers/request";
import { monthsBack, type UsageReport } from "./usage-report";

let alice: TestUser;
let bob: TestUser;
const saved = { key: process.env.GOOGLE_MAPS_API_KEY, ai: process.env.AI_GATEWAY_API_KEY };

beforeEach(async () => {
  await resetDb();
  alice = await createTestUser();
  bob = await createTestUser();
});
afterEach(() => {
  if (saved.key === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = saved.key;
  if (saved.ai === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = saved.ai;
  resetEnvCache();
});
afterAll(closeDb);

const me = (u: TestUser) => meRoute(apiRequest("/api/v1/me", { user: u }), ctx({}));
const usage = (u: TestUser, qs = "") => usageRoute(apiRequest(`/api/v1/usage${qs}`, { user: u }), ctx({}));

const thisMonth = new Date();
const monthsAgo = (n: number) => new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - n, 15));

describe("GET /api/v1/me", () => {
  it("returns the user, limits with usage this month, and what the server offers", async () => {
    await db().insert(userSettings).values({ userId: alice.id, maxResultsPerSearch: 500, monthlyRequestLimit: 300 });
    await db()
      .insert(usageLogs)
      .values([
        { userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 12, billable: true },
        { userId: alice.id, provider: "sample", operation: "text_search", requestCount: 40, billable: false },
        { userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 99, billable: true, createdAt: monthsAgo(1) },
        { userId: bob.id, provider: "google_places", operation: "text_search", requestCount: 7, billable: true },
      ]);
    const res = await me(alice);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body).toMatchObject({
      id: alice.id,
      email: alice.email,
      role: "member",
      status: "active",
      limits: { maxResultsPerSearch: 500, monthlyRequestLimit: 300, usedThisMonth: 12, maxConcurrentJobs: 2 },
      sampleMode: true,
      aiAvailable: false,
      providers: [{ id: "sample", isSample: true }],
    });

    const bobs = (await (await me(bob)).json()) as MeResponse;
    expect(bobs.limits).toMatchObject({ maxResultsPerSearch: 20000, monthlyRequestLimit: 5000, usedThisMonth: 7 });
  });

  it("reflects a configured Google key and AI gateway", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key-not-real";
    process.env.AI_GATEWAY_API_KEY = "test-ai-key";
    resetEnvCache();
    const body = (await (await me(alice)).json()) as MeResponse;
    expect(body.sampleMode).toBe(false);
    expect(body.aiAvailable).toBe(true);
    expect(body.providers.map((p) => p.id)).toEqual(["google_places", "sample"]);
  });

  it("requires sign-in", async () => {
    expect((await meRoute(apiRequest("/api/v1/me"), ctx({}))).status).toBe(401);
  });
});

describe("GET /api/v1/usage", () => {
  beforeEach(async () => {
    await db()
      .insert(usageLogs)
      .values([
        { userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 10, billable: true, estimatedCostUsd: 0.35 },
        { userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 5, billable: true, estimatedCostUsd: 0.175 },
        { userId: alice.id, provider: "google_places", operation: "geocode", requestCount: 1, billable: true, estimatedCostUsd: 0.035 },
        { userId: alice.id, provider: "sample", operation: "text_search", requestCount: 30, billable: false },
        { userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 4, billable: true, estimatedCostUsd: 0.14, createdAt: monthsAgo(2) },
        // Older than 6 months: not reported.
        { userId: alice.id, provider: "google_places", operation: "text_search", requestCount: 1000, billable: true, estimatedCostUsd: 35, createdAt: monthsAgo(7) },
        { userId: bob.id, provider: "google_places", operation: "text_search", requestCount: 3, billable: true, estimatedCostUsd: 0.105 },
      ]);
  });

  it("reports the user's own usage by month, provider and operation", async () => {
    const res = await usage(alice);
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsageReport;
    const months = monthsBack(6).months;
    expect(body.scope).toBe("me");
    expect(body.months).toEqual(months);
    expect(body.rows).toEqual([
      { month: months[0], provider: "google_places", operation: "geocode", requests: 1, billableRequests: 1, estimatedCostUsd: 0.035 },
      { month: months[0], provider: "google_places", operation: "text_search", requests: 15, billableRequests: 15, estimatedCostUsd: 0.525 },
      { month: months[0], provider: "sample", operation: "text_search", requests: 30, billableRequests: 0, estimatedCostUsd: 0 },
      { month: months[2], provider: "google_places", operation: "text_search", requests: 4, billableRequests: 4, estimatedCostUsd: 0.14 },
    ]);
    expect(body.totals).toEqual({ requests: 50, billableRequests: 20, estimatedCostUsd: 0.7 });
  });

  it("lets admins see everyone, grouped by user", async () => {
    expect((await usage(alice, "?all=1")).status).toBe(403);
    const admin = await createTestUser({ role: "admin" });
    const body = (await (await usage(admin, "?all=1")).json()) as UsageReport;
    expect(body.scope).toBe("all");
    const bobRows = body.rows.filter((r) => r.user?.id === bob.id);
    expect(bobRows).toEqual([
      expect.objectContaining({ provider: "google_places", operation: "text_search", requests: 3, user: { id: bob.id, name: expect.any(String), email: bob.email } }),
    ]);
    expect(body.totals.billableRequests).toBe(23);
    // Without ?all an admin sees only their own (empty) usage.
    expect(((await (await usage(admin)).json()) as UsageReport).rows).toEqual([]);
  });
});
