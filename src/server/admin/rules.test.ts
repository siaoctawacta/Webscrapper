import { describe, expect, it } from "vitest";
import { planUserChange, type UserFacts } from "./rules";
import { adminUserPatchSchema, auditQuerySchema, invitationCreateSchema, userIdParam } from "./schemas";

const facts = (o: Partial<UserFacts> = {}): UserFacts => ({
  id: "target",
  role: "member",
  status: "active",
  maxResultsPerSearch: null,
  monthlyRequestLimit: null,
  ...o,
});

describe("planUserChange", () => {
  it("blocks changing your own role or status but allows your own limits", () => {
    const self = facts({ id: "me", role: "admin" });
    expect(planUserChange({ actorId: "me", target: self, patch: { role: "member" }, otherActiveAdmins: 3 })).toMatchObject({
      ok: false,
      code: "forbidden",
      reason: "self_change",
    });
    expect(planUserChange({ actorId: "me", target: self, patch: { status: "disabled" }, otherActiveAdmins: 3 })).toMatchObject({
      ok: false,
      reason: "self_change",
    });
    // Same value = no change = allowed.
    expect(planUserChange({ actorId: "me", target: self, patch: { role: "admin" }, otherActiveAdmins: 0 })).toMatchObject({ ok: true, after: {} });
    expect(planUserChange({ actorId: "me", target: self, patch: { monthlyRequestLimit: 10 }, otherActiveAdmins: 0 })).toMatchObject({
      ok: true,
      after: { monthlyRequestLimit: 10 },
    });
  });

  it("protects the last active admin from demotion and disabling", () => {
    const lastAdmin = facts({ role: "admin" });
    for (const patch of [{ role: "member" as const }, { status: "disabled" as const }]) {
      expect(planUserChange({ actorId: "other", target: lastAdmin, patch, otherActiveAdmins: 0 })).toMatchObject({
        ok: false,
        code: "conflict",
        reason: "last_admin",
      });
      expect(planUserChange({ actorId: "other", target: lastAdmin, patch, otherActiveAdmins: 1 }).ok).toBe(true);
    }
    // A disabled admin is not an active admin: changing them is fine.
    expect(planUserChange({ actorId: "other", target: facts({ role: "admin", status: "disabled" }), patch: { role: "member" }, otherActiveAdmins: 0 }).ok).toBe(true);
  });

  it("records only real changes and revokes sessions when disabling", () => {
    const p = planUserChange({
      actorId: "admin",
      target: facts({ status: "pending", maxResultsPerSearch: 100 }),
      patch: { status: "disabled", role: "member", maxResultsPerSearch: null },
      otherActiveAdmins: 1,
    });
    expect(p).toEqual({
      ok: true,
      before: { status: "pending", maxResultsPerSearch: 100 },
      after: { status: "disabled", maxResultsPerSearch: null },
      userUpdate: { status: "disabled" },
      limitsUpdate: { maxResultsPerSearch: null },
      revokeSessions: true,
    });
    const approve = planUserChange({ actorId: "admin", target: facts({ status: "pending" }), patch: { status: "active" }, otherActiveAdmins: 1 });
    expect(approve).toMatchObject({ ok: true, revokeSessions: false, after: { status: "active" } });
  });
});

describe("admin schemas", () => {
  it("validates user patches", () => {
    expect(adminUserPatchSchema.safeParse({}).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ status: "pending" }).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ maxResultsPerSearch: 0 }).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ maxResultsPerSearch: 20001 }).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ maxResultsPerSearch: 1.5 }).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ monthlyRequestLimit: -1 }).success).toBe(false);
    expect(adminUserPatchSchema.parse({ maxResultsPerSearch: null, monthlyRequestLimit: 0 })).toEqual({ maxResultsPerSearch: null, monthlyRequestLimit: 0 });
    expect(adminUserPatchSchema.parse({ role: "admin", status: "active", maxResultsPerSearch: 20000 })).toBeTruthy();
  });

  it("lower-cases invitation emails and defaults the role", () => {
    expect(invitationCreateSchema.parse({ email: "  Ama@Studio.TG " })).toEqual({ email: "ama@studio.tg", role: "member" });
    expect(invitationCreateSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(invitationCreateSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
  });

  it("validates audit queries", () => {
    expect(auditQuerySchema.parse({})).toEqual({ page: 1 });
    expect(auditQuerySchema.parse({ page: "3", action: "admin.user" })).toEqual({ page: 3, action: "admin.user" });
    expect(auditQuerySchema.parse({ action: "" })).toEqual({ page: 1, action: undefined });
    expect(auditQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ action: "admin%" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ action: "a'; drop table x;--" }).success).toBe(false);
  });

  it("treats implausible user ids as not found", () => {
    expect(userIdParam("AbC123_-")).toBe("AbC123_-");
    for (const bad of [undefined, "", "a".repeat(65), "../x", "a b", ["x"]]) {
      expect(() => userIdParam(bad as string)).toThrow(/User not found/);
    }
  });
});
