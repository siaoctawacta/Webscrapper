import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getSettings, PUT as putSettings } from "@/app/api/v1/me/settings/route";
import { GET as getGridPrefsRoute, PUT as putGridPrefs } from "@/app/api/v1/me/grid-prefs/route";
import type { SenderProfile } from "@/lib/api-types";
import type { GridPrefs } from "@/lib/grid-prefs";
import { closeDb, db } from "@/server/db";
import { auditLogs, userSettings } from "@/server/db/schema";
import { createTestUser, type TestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../tests/helpers/request";
import { getSenderProfile, getUserLimitOverrides } from "./index";

const noParams = () => ctx({});
const put = (u: TestUser | undefined, b: unknown) => putSettings(apiRequest("/api/v1/me/settings", { method: "PUT", body: b, user: u }), noParams());
const get = (u?: TestUser) => getSettings(apiRequest("/api/v1/me/settings", { user: u }), noParams());
const putPrefs = (u: TestUser, b: unknown) => putGridPrefs(apiRequest("/api/v1/me/grid-prefs", { method: "PUT", body: b, user: u }), noParams());
const getPrefs = (u: TestUser) => getGridPrefsRoute(apiRequest("/api/v1/me/grid-prefs", { user: u }), noParams());

beforeEach(resetDb);
afterAll(closeDb);

describe("sender profile settings", () => {
  it("returns nulls and English when nothing is saved yet", async () => {
    const u = await createTestUser();
    const res = await get(u);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      senderName: null,
      senderCompany: null,
      senderEmail: null,
      senderPhone: null,
      senderWebsite: null,
      senderPortfolioUrl: null,
      signature: null,
      defaultLanguage: "en",
    });
  });

  it("upserts, merges partial updates, clears with null/empty and audits", async () => {
    const u = await createTestUser();
    const first = await put(u, {
      senderName: "Kofi Mensah",
      senderCompany: "Akwaaba Studio",
      senderEmail: "kofi@akwaaba.example",
      senderPhone: "+233 24 123 4567",
      senderWebsite: "akwaaba.example",
      senderPortfolioUrl: "https://dribbble.com/kofi",
      signature: "Kofi Mensah\nAkwaaba Studio",
      defaultLanguage: "fr",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ senderWebsite: "https://akwaaba.example", defaultLanguage: "fr" });

    const second = await put(u, { senderCompany: "", senderPhone: null, signature: "Merci,\nKofi" });
    const merged = (await second.json()) as SenderProfile;
    expect(merged).toEqual({
      senderName: "Kofi Mensah",
      senderCompany: null,
      senderEmail: "kofi@akwaaba.example",
      senderPhone: null,
      senderWebsite: "https://akwaaba.example",
      senderPortfolioUrl: "https://dribbble.com/kofi",
      signature: "Merci,\nKofi",
      defaultLanguage: "fr",
    });
    expect(await (await get(u)).json()).toEqual(merged);
    expect(await getSenderProfile(u)).toEqual(merged);
    expect(await db().select().from(userSettings).where(eq(userSettings.userId, u.id))).toHaveLength(1);

    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "settings.update")).orderBy(auditLogs.id);
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ actorId: u.id, resourceId: u.id, metadata: { fields: ["senderCompany", "senderPhone", "signature"] } });
  });

  it("rejects invalid values with field-level details and changes nothing", async () => {
    const u = await createTestUser();
    await put(u, { senderName: "Ama" });
    const res = await put(u, {
      senderName: "Ama B",
      senderEmail: "ama@",
      senderWebsite: "javascript:alert(1)",
      senderPortfolioUrl: "ftp://x.example.com",
      senderCompany: "x".repeat(201),
      signature: "y".repeat(1001),
      defaultLanguage: "es",
    });
    expect(res.status).toBe(422);
    const err = (await res.json()) as { error: { code: string; details: { path: string }[] } };
    expect(err.error.code).toBe("validation_failed");
    expect(err.error.details.map((d) => d.path).sort()).toEqual(
      ["defaultLanguage", "senderCompany", "senderEmail", "senderPortfolioUrl", "senderWebsite", "signature"].sort(),
    );
    expect((await getSenderProfile(u)).senderName).toBe("Ama");
    expect((await put(u, "not json")).status).toBe(422);
  });

  it("requires an active, signed-in user", async () => {
    const pending = await createTestUser({ status: "pending" });
    expect((await get(undefined)).status).toBe(401);
    expect((await get(pending)).status).toBe(403);
    expect((await put(pending, { senderName: "x" })).status).toBe(403);
  });

  it("does not touch admin limit overrides", async () => {
    const u = await createTestUser();
    await db().insert(userSettings).values({ userId: u.id, maxResultsPerSearch: 100, monthlyRequestLimit: 50 });
    await put(u, { senderName: "Kofi" });
    expect(await getUserLimitOverrides(u.id)).toEqual({ maxResultsPerSearch: 100, monthlyRequestLimit: 50 });
  });
});

describe("grid preferences", () => {
  it("starts empty, merges per context and resets with null", async () => {
    const u = await createTestUser();
    expect(await (await getPrefs(u)).json()).toEqual({});

    const r1 = await putPrefs(u, { results: { columns: ["business_name", "phone", "phone", "email"], pageSize: 25 } });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ results: { columns: ["business_name", "phone", "email"], pageSize: 25 } });

    const r2 = await putPrefs(u, { collection: { columns: ["business_name", "lead_status", "tags"] } });
    expect(await r2.json()).toEqual({
      results: { columns: ["business_name", "phone", "email"], pageSize: 25 },
      collection: { columns: ["business_name", "lead_status", "tags"] },
    });

    const r3 = await putPrefs(u, { results: { pageSize: 100 } });
    expect(((await r3.json()) as GridPrefs).results).toEqual({ columns: ["business_name", "phone", "email"], pageSize: 100 });

    const r4 = await putPrefs(u, { results: null });
    expect(await r4.json()).toEqual({ collection: { columns: ["business_name", "lead_status", "tags"] } });
    expect(await (await getPrefs(u)).json()).toEqual({ collection: { columns: ["business_name", "lead_status", "tags"] } });

    const [row] = await db().select({ gridPrefs: userSettings.gridPrefs }).from(userSettings).where(eq(userSettings.userId, u.id));
    expect(row?.gridPrefs).toEqual({ collection: { columns: ["business_name", "lead_status", "tags"] } });
  });

  it("validates columns against the grid and keeps the sender profile intact", async () => {
    const u = await createTestUser();
    await put(u, { senderName: "Kofi" });
    expect((await putPrefs(u, { results: { columns: ["tags"] } })).status).toBe(422);
    expect((await putPrefs(u, { results: { columns: ["drop table"] } })).status).toBe(422);
    expect((await putPrefs(u, { results: { pageSize: 10 } })).status).toBe(422);
    expect((await putPrefs(u, { nonsense: {} })).status).toBe(422);
    expect((await putPrefs(u, { results: { columns: ["email"] } })).status).toBe(200);
    expect((await getSenderProfile(u)).senderName).toBe("Kofi");
  });

  it("ignores stale stored entries when reading", async () => {
    const u = await createTestUser();
    await db().insert(userSettings).values({ userId: u.id, gridPrefs: { results: { columns: ["old_field", "phone"], pageSize: 13 }, junk: true } });
    expect(await (await getPrefs(u)).json()).toEqual({ results: { columns: ["phone"] } });
  });
});
