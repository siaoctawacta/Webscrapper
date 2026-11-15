import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { GET as listUsersRoute } from "@/app/api/v1/admin/users/route";
import { PATCH as patchUserRoute } from "@/app/api/v1/admin/users/[id]/route";
import { GET as listInvitationsRoute, POST as createInvitationRoute } from "@/app/api/v1/admin/invitations/route";
import { DELETE as revokeInvitationRoute } from "@/app/api/v1/admin/invitations/[id]/route";
import { GET as usageRoute } from "@/app/api/v1/admin/usage/route";
import { GET as auditRoute } from "@/app/api/v1/admin/audit/route";
import { GET as settingsRoute } from "@/app/api/v1/me/settings/route";
import { getAuth } from "@/server/auth/auth";
import { closeDb, db } from "@/server/db";
import { auditLogs, invitations, session, usageLogs, user, userSettings } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { createTestUser, type TestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../tests/helpers/request";
import { LAST_ADMIN_MESSAGE, SELF_CHANGE_MESSAGE } from "./rules";
import type { AdminUserDto, AdminUsersResponse, AuditLogResponse, InvitationDto, InvitationsResponse, UsageResponse } from "./types";

const noParams = () => ctx({});
const body = async <T>(res: Response) => (await res.json()) as T;

const patchUser = (actor: TestUser, id: string, patch: unknown) =>
  patchUserRoute(apiRequest(`/api/v1/admin/users/${id}`, { method: "PATCH", body: patch, user: actor }), ctx({ id }));

const resetAuth = () => {
  resetEnvCache();
  delete (globalThis as { __leadfinderAuth?: unknown }).__leadfinderAuth;
};

const signUp = (email: string, inviteToken?: string) =>
  getAuth().api.signUpEmail({
    body: { email, password: "a-long-password-123", name: "New Person" },
    headers: new Headers(inviteToken ? { "x-invite-token": inviteToken } : {}),
    asResponse: true,
  });

/** The secret token from a personal invite link. */
const tokenOf = (inv: InvitationDto) => new URL(inv.inviteUrl!).searchParams.get("invite")!;

async function auditRows(action: string) {
  return db().select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(auditLogs.id);
}

beforeEach(resetDb);
afterEach(() => {
  process.env.SIGNUP_MODE = "approval";
  resetAuth();
});
afterAll(closeDb);

describe("admin access", () => {
  it("rejects members (403) and anonymous callers (401) on every admin API", async () => {
    await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const calls: [string, (u?: TestUser) => Promise<Response>][] = [
      ["users", (u) => listUsersRoute(apiRequest("/api/v1/admin/users", { user: u }), noParams())],
      ["patch", (u) => patchUserRoute(apiRequest(`/api/v1/admin/users/${member.id}`, { method: "PATCH", body: { role: "admin" }, user: u }), ctx({ id: member.id }))],
      ["invitations", (u) => listInvitationsRoute(apiRequest("/api/v1/admin/invitations", { user: u }), noParams())],
      ["invite", (u) => createInvitationRoute(apiRequest("/api/v1/admin/invitations", { method: "POST", body: { email: "x@y.co" }, user: u }), noParams())],
      ["usage", (u) => usageRoute(apiRequest("/api/v1/admin/usage", { user: u }), noParams())],
      ["audit", (u) => auditRoute(apiRequest("/api/v1/admin/audit", { user: u }), noParams())],
    ];
    for (const [name, call] of calls) {
      expect((await call(member)).status, name).toBe(403);
      expect((await call(undefined)).status, name).toBe(401);
    }
    const [{ role }] = (await db().select({ role: user.role }).from(user).where(eq(user.id, member.id))) as [{ role: string }];
    expect(role).toBe("member");
  });
});

describe("users", () => {
  it("lists users with pending first, last activity and billable requests this month", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const pending = await createTestUser({ status: "pending" });
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    await db().insert(usageLogs).values([
      { userId: member.id, provider: "google_places", operation: "text_search", requestCount: 3, billable: true, estimatedCostUsd: 0.105 },
      { userId: member.id, provider: "google_places", operation: "text_search", requestCount: 2, billable: true, estimatedCostUsd: 0.07 },
      { userId: member.id, provider: "sample", operation: "text_search", requestCount: 50, billable: false },
      { userId: member.id, provider: "google_places", operation: "text_search", requestCount: 7, billable: true, createdAt: lastMonth },
    ]);
    await db().insert(userSettings).values({ userId: member.id, maxResultsPerSearch: 500 });

    const res = await listUsersRoute(apiRequest("/api/v1/admin/users", { user: admin }), noParams());
    expect(res.status).toBe(200);
    const data = await body<AdminUsersResponse>(res);
    expect(data.pendingCount).toBe(1);
    expect(data.users[0]?.id).toBe(pending.id);
    expect(data.users).toHaveLength(3);
    const m = data.users.find((u) => u.id === member.id)!;
    expect(m).toMatchObject({ role: "member", status: "active", requestsThisMonth: 5, maxResultsPerSearch: 500, monthlyRequestLimit: null });
    expect(m.lastActiveAt).not.toBeNull();
    expect(data.defaults.maxResultsPerSearch).toBeGreaterThan(0);
  });

  it("approves, changes role and limits, and audits each change with before/after", async () => {
    const admin = await createTestUser({ role: "admin" });
    const pending = await createTestUser({ status: "pending" });

    const approve = await patchUser(admin, pending.id, { status: "active" });
    expect(approve.status).toBe(200);
    expect(await body<AdminUserDto>(approve)).toMatchObject({ id: pending.id, status: "active" });

    const promote = await patchUser(admin, pending.id, { role: "admin" });
    expect(await body<AdminUserDto>(promote)).toMatchObject({ role: "admin" });
    const demote = await patchUser(admin, pending.id, { role: "member" });
    expect(await body<AdminUserDto>(demote)).toMatchObject({ role: "member" });

    const limits = await patchUser(admin, pending.id, { maxResultsPerSearch: 1000, monthlyRequestLimit: 0 });
    expect(await body<AdminUserDto>(limits)).toMatchObject({ maxResultsPerSearch: 1000, monthlyRequestLimit: 0 });
    const reset = await patchUser(admin, pending.id, { maxResultsPerSearch: null });
    expect(await body<AdminUserDto>(reset)).toMatchObject({ maxResultsPerSearch: null, monthlyRequestLimit: 0 });

    // No-op change: nothing audited.
    expect((await patchUser(admin, pending.id, { role: "member" })).status).toBe(200);

    const entries = await auditRows("admin.user.update");
    expect(entries.map((e) => e.metadata)).toEqual([
      { before: { status: "pending" }, after: { status: "active" } },
      { before: { role: "member" }, after: { role: "admin" } },
      { before: { role: "admin" }, after: { role: "member" } },
      { before: { maxResultsPerSearch: null, monthlyRequestLimit: null }, after: { maxResultsPerSearch: 1000, monthlyRequestLimit: 0 } },
      { before: { maxResultsPerSearch: 1000 }, after: { maxResultsPerSearch: null } },
    ]);
    expect(entries.every((e) => e.actorId === admin.id && e.resourceId === pending.id && e.outcome === "success")).toBe(true);
  });

  it("blocks changing your own role or status (audited as denied) but allows your own limits", async () => {
    const admin = await createTestUser({ role: "admin" });
    await createTestUser({ role: "admin" });

    const role = await patchUser(admin, admin.id, { role: "member" });
    expect(role.status).toBe(403);
    expect((await body<{ error: { message: string } }>(role)).error.message).toBe(SELF_CHANGE_MESSAGE);
    expect((await patchUser(admin, admin.id, { status: "disabled" })).status).toBe(403);
    expect((await patchUser(admin, admin.id, { monthlyRequestLimit: 100 })).status).toBe(200);

    const [row] = await db().select().from(user).where(eq(user.id, admin.id));
    expect(row).toMatchObject({ role: "admin", status: "active" });
    const denied = (await auditRows("admin.user.update")).filter((e) => e.outcome === "denied");
    expect(denied).toHaveLength(2);
    expect(denied[0]?.metadata).toMatchObject({ reason: "self_change" });
  });

  it("never leaves the app without an active admin, even with concurrent demotions", async () => {
    const a = await createTestUser({ role: "admin" });
    const b = await createTestUser({ role: "admin" });
    const results = await Promise.all([patchUser(a, b.id, { role: "member" }), patchUser(b, a.id, { status: "disabled" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const admins = await db().select().from(user).where(and(eq(user.role, "admin"), eq(user.status, "active")));
    expect(admins).toHaveLength(1);
    expect(LAST_ADMIN_MESSAGE).toMatch(/at least one active administrator/);
  });

  it("disabling deletes the user's sessions so their next request is 401; enabling restores access to sign in", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    // A second device.
    const login = await getAuth().api.signInEmail({ body: { email: member.email, password: "correct-horse-battery-staple" }, asResponse: true });
    expect(login.ok).toBe(true);
    expect(await db().select().from(session).where(eq(session.userId, member.id))).toHaveLength(2);

    const ok = await settingsRoute(apiRequest("/api/v1/me/settings", { user: member }), noParams());
    expect(ok.status).toBe(200);

    const res = await patchUser(admin, member.id, { status: "disabled" });
    expect(res.status).toBe(200);
    expect(await body<AdminUserDto>(res)).toMatchObject({ status: "disabled", lastActiveAt: null });
    expect(await db().select().from(session).where(eq(session.userId, member.id))).toHaveLength(0);

    const after = await settingsRoute(apiRequest("/api/v1/me/settings", { user: member }), noParams());
    expect(after.status).toBe(401);
    const [entry] = await auditRows("admin.user.update");
    expect(entry?.metadata).toEqual({ before: { status: "active" }, after: { status: "disabled" }, sessionsRevoked: 2 });

    expect(await body<AdminUserDto>(await patchUser(admin, member.id, { status: "active" }))).toMatchObject({ status: "active" });
    const relogin = await getAuth().api.signInEmail({ body: { email: member.email, password: "correct-horse-battery-staple" }, asResponse: true });
    expect(relogin.ok).toBe(true);
  });

  it("validates input and returns 404 for unknown or malformed ids", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    expect((await patchUser(admin, member.id, {})).status).toBe(422);
    expect((await patchUser(admin, member.id, { maxResultsPerSearch: 0 })).status).toBe(422);
    expect((await patchUser(admin, member.id, { monthlyRequestLimit: -5 })).status).toBe(422);
    expect((await patchUser(admin, member.id, { status: "pending" })).status).toBe(422);
    expect((await patchUser(admin, "doesNotExist123", { role: "admin" })).status).toBe(404);
    expect((await patchUser(admin, "x".repeat(65), { role: "admin" })).status).toBe(404);
    expect((await patchUser(admin, "../etc", { role: "admin" })).status).toBe(404);
  });
});

describe("invitations and sign-up modes", () => {
  const invite = (actor: TestUser, payload: unknown) =>
    createInvitationRoute(apiRequest("/api/v1/admin/invitations", { method: "POST", body: payload, user: actor }), noParams());

  it("creates (lower-cased), lists and revokes invitations, with audit entries", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();

    const created = await invite(admin, { email: "  Ama.Owusu@Studio.GH ", role: "admin" });
    expect(created.status).toBe(201);
    const inv = await body<InvitationDto>(created);
    expect(inv).toMatchObject({ email: "ama.owusu@studio.gh", role: "admin", status: "pending", invitedBy: { id: admin.id } });

    expect((await invite(admin, { email: "AMA.OWUSU@studio.gh" })).status).toBe(409);
    expect((await invite(admin, { email: member.email.toUpperCase() })).status).toBe(409);
    expect((await invite(admin, { email: "nope" })).status).toBe(422);

    const list = await body<InvitationsResponse>(await listInvitationsRoute(apiRequest("/api/v1/admin/invitations", { user: admin }), noParams()));
    expect(list.signupMode).toBe("approval");
    expect(list.invitations.map((i) => i.email)).toEqual(["ama.owusu@studio.gh"]);

    const revoke = (id: string) =>
      revokeInvitationRoute(apiRequest(`/api/v1/admin/invitations/${id}`, { method: "DELETE", user: admin }), ctx({ id }));
    expect((await revoke(inv.id)).status).toBe(204);
    expect((await revoke(inv.id)).status).toBe(404);
    expect((await revoke("not-a-uuid")).status).toBe(404);
    expect(await db().select().from(invitations)).toHaveLength(0);

    expect((await auditRows("admin.invitation.create"))[0]).toMatchObject({ actorId: admin.id, resourceId: inv.id, metadata: { email: "ama.owusu@studio.gh", role: "admin" } });
    expect((await auditRows("admin.invitation.revoke"))[0]).toMatchObject({ actorId: admin.id, resourceId: inv.id });
  });

  for (const mode of ["invite", "closed"] as const) {
    it(`SIGNUP_MODE=${mode}: only a personal invite link (token + matching email) gets in`, async () => {
      const admin = await createTestUser({ role: "admin" });
      const inv = await body<InvitationDto>(await invite(admin, { email: "kofi@studio.gh", role: "member" }));
      expect(inv.inviteUrl).toMatch(/\/sign-up\?invite=[\w-]{40,}&email=kofi%40studio\.gh$/);
      const revoked = await body<InvitationDto>(await invite(admin, { email: "revoked@studio.gh" }));
      await revokeInvitationRoute(apiRequest(`/api/v1/admin/invitations/${revoked.id}`, { method: "DELETE", user: admin }), ctx({ id: revoked.id }));
      // The token is stored only as a hash.
      const [stored] = await db().select().from(invitations).where(eq(invitations.id, inv.id));
      expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored!.tokenHash).not.toContain(tokenOf(inv));

      process.env.SIGNUP_MODE = mode;
      resetAuth();

      const expected = mode === "invite" ? "Sign-up needs a valid invitation link. Ask your administrator for one." : "Sign-up is closed.";
      const stranger = await signUp("stranger@example.com");
      expect(stranger.status).toBe(403);
      expect(((await stranger.json()) as { message: string }).message).toBe(expected);
      // Knowing an invited email is not enough, and the answer doesn't reveal that it was invited.
      const noToken = await signUp("kofi@studio.gh");
      expect(noToken.status).toBe(403);
      expect(((await noToken.json()) as { message: string }).message).toBe(expected);
      expect((await signUp("kofi@studio.gh", "wrong-token")).status).toBe(403);
      // A valid token for a different email doesn't work either.
      expect((await signUp("attacker@example.com", tokenOf(inv))).status).toBe(403);
      expect((await signUp("revoked@studio.gh", tokenOf(revoked))).status).toBe(403);

      const invited = await signUp("Kofi@Studio.GH", tokenOf(inv));
      expect(invited.ok).toBe(true);
      const [row] = await db().select().from(user).where(eq(user.email, "kofi@studio.gh"));
      expect(row).toMatchObject({ role: "member", status: "active" });

      const list = await body<InvitationsResponse>(await listInvitationsRoute(apiRequest("/api/v1/admin/invitations", { user: admin }), noParams()));
      expect(list.signupMode).toBe(mode);
      expect(list.invitations.find((i) => i.id === inv.id)).toMatchObject({ status: "accepted" });
      expect(list.invitations.find((i) => i.id === inv.id)?.acceptedAt).not.toBeNull();
      expect(list.invitations.every((i) => i.inviteUrl === undefined)).toBe(true);

      // Used invitations cannot be revoked.
      const res = await revokeInvitationRoute(apiRequest(`/api/v1/admin/invitations/${inv.id}`, { method: "DELETE", user: admin }), ctx({ id: inv.id }));
      expect(res.status).toBe(409);
    });
  }

  it("in approval mode, the invited role needs the invite link; without it the person waits for approval", async () => {
    const admin = await createTestUser({ role: "admin" });
    const inv = await body<InvitationDto>(await invite(admin, { email: "invited@studio.tg", role: "admin" }));
    await invite(admin, { email: "squatter@studio.tg", role: "admin" });
    expect((await signUp("someone@example.com")).ok).toBe(true);
    expect((await signUp("squatter@studio.tg")).ok).toBe(true); // claims an invited email without the link
    expect((await signUp("invited@studio.tg", tokenOf(inv))).ok).toBe(true);
    const rows = await db().select({ email: user.email, role: user.role, status: user.status }).from(user);
    expect(rows).toEqual(
      expect.arrayContaining([
        { email: "someone@example.com", role: "member", status: "pending" },
        { email: "squatter@studio.tg", role: "member", status: "pending" },
        { email: "invited@studio.tg", role: "admin", status: "active" },
      ]),
    );
  });
});

describe("usage report", () => {
  it("aggregates billable requests and estimated cost by user and month (last 6 months) with totals", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const now = new Date();
    const monthsAgo = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 10, 12));
    const g = { provider: "google_places", operation: "text_search", billable: true } as const;
    await db().insert(usageLogs).values([
      { ...g, userId: member.id, requestCount: 10, estimatedCostUsd: 0.35, createdAt: monthsAgo(0) },
      { ...g, userId: member.id, requestCount: 4, estimatedCostUsd: 0.14, createdAt: monthsAgo(2) },
      { ...g, userId: admin.id, requestCount: 1, estimatedCostUsd: 0.035, createdAt: monthsAgo(5) },
      { ...g, userId: null, requestCount: 2, estimatedCostUsd: 0.07, createdAt: monthsAgo(1) },
      { ...g, userId: member.id, requestCount: 99, estimatedCostUsd: 3.465, createdAt: monthsAgo(6) },
      { provider: "sample", operation: "text_search", billable: false, userId: member.id, requestCount: 500, createdAt: monthsAgo(0) },
    ]);

    const res = await usageRoute(apiRequest("/api/v1/admin/usage", { user: admin }), noParams());
    expect(res.status).toBe(200);
    const data = await body<UsageResponse>(res);
    expect(data.months).toHaveLength(6);
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(data.months[5]).toBe(current);

    const m = data.rows.find((r) => r.userId === member.id)!;
    expect(m.months[5]).toEqual({ requests: 10, costUsd: 0.35 });
    expect(m.months[3]).toEqual({ requests: 4, costUsd: 0.14 });
    expect(m.total).toEqual({ requests: 14, costUsd: 0.49 });
    expect(m.email).toBe(member.email);
    expect(data.rows.find((r) => r.userId === null)).toMatchObject({ name: null, total: { requests: 2 } });
    expect(data.rows.find((r) => r.userId === admin.id)?.months[0]).toEqual({ requests: 1, costUsd: 0.035 });
    expect(data.totals.total).toEqual({ requests: 17, costUsd: 0.595 });
    expect(data.totals.months[5]).toEqual({ requests: 10, costUsd: 0.35 });
    expect(data.pricing.textSearchPer1000).toBeGreaterThan(0);
  });
});

describe("audit log", () => {
  it("pages newest first (50 per page), filters by action prefix and validates the query", async () => {
    const admin = await createTestUser({ role: "admin" });
    const base = Date.now() - 1000 * 60 * 60;
    await db().insert(auditLogs).values(
      Array.from({ length: 55 }, (_, i) => ({
        actorId: admin.id,
        action: i % 2 ? "search.create" : "admin.user.update",
        resourceType: "x",
        resourceId: String(i),
        outcome: "success" as const,
        metadata: { i },
        createdAt: new Date(base + i * 1000),
      })),
    );
    await db().insert(auditLogs).values({ actorId: null, action: "admin_user.other", resourceType: "x", outcome: "error", createdAt: new Date(base - 5000) });

    const get = (qs: string) => auditRoute(apiRequest(`/api/v1/admin/audit${qs}`, { user: admin }), noParams());
    const p1 = await body<AuditLogResponse>(await get(""));
    expect(p1.total).toBe(56);
    expect(p1.entries).toHaveLength(50);
    expect(p1.entries[0]).toMatchObject({ resourceId: "54", actor: { email: admin.email }, metadata: { i: 54 } });
    const p2 = await body<AuditLogResponse>(await get("?page=2"));
    expect(p2.entries).toHaveLength(6);
    expect(p2.entries.at(-1)).toMatchObject({ action: "admin_user.other", actor: null, outcome: "error" });

    const filtered = await body<AuditLogResponse>(await get("?action=admin.user"));
    expect(filtered.total).toBe(28);
    expect(filtered.entries.every((e) => e.action === "admin.user.update")).toBe(true);
    // "_" is not a wildcard and a prefix must match whole segments.
    expect((await body<AuditLogResponse>(await get("?action=admin_user"))).total).toBe(1);
    expect((await body<AuditLogResponse>(await get("?action=adm"))).total).toBe(0);
    expect(p1.prefixes).toEqual(expect.arrayContaining(["admin", "admin.user", "search", "admin_user"]));

    expect((await get("?page=0")).status).toBe(422);
    expect((await get("?action=admin%25")).status).toBe(422);
  });

  it("records every admin change in the audit log", async () => {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    await patchUser(admin, member.id, { role: "admin" });
    await createInvitationRoute(apiRequest("/api/v1/admin/invitations", { method: "POST", body: { email: "a@b.co" }, user: admin }), noParams());
    const rows = await db().select({ action: auditLogs.action }).from(auditLogs).orderBy(sql`${auditLogs.id}`);
    expect(rows.map((r) => r.action)).toEqual(["admin.user.update", "admin.invitation.create"]);
  });
});
