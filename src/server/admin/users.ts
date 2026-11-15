import "server-only";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db, type DbOrTx } from "../db";
import { searchJobs, session, usageLogs, user, userSettings } from "../db/schema";
import { env } from "../env";
import { HttpError, notFound } from "../errors";
import { startOfMonthUtc } from "../usage";
import { planUserChange, type UserFacts } from "./rules";
import type { AdminUserPatch } from "./schemas";
import type { AdminLimitDefaults, AdminUserDto, AdminUsersResponse } from "./types";

/** Serialises admin role/status changes so concurrent requests cannot remove the last admin. */
const ADMIN_CHANGE_LOCK = 724002;

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function selectUsers(tx: DbOrTx, now: Date) {
  const monthStart = startOfMonthUtc(now);
  return tx
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      lastActiveAt: sql<unknown>`(select max(${session.updatedAt}) from ${session} where ${session.userId} = ${user.id})`,
      requestsThisMonth: sql<number>`coalesce((
        select sum(${usageLogs.requestCount}) from ${usageLogs}
        where ${usageLogs.userId} = ${user.id} and ${usageLogs.billable} = true and ${usageLogs.createdAt} >= ${monthStart}
      ), 0)::int`,
      maxResultsPerSearch: userSettings.maxResultsPerSearch,
      monthlyRequestLimit: userSettings.monthlyRequestLimit,
    })
    .from(user)
    .leftJoin(userSettings, eq(userSettings.userId, user.id));
}

type UserRow = Awaited<ReturnType<typeof selectUsers>>[number];

const toDto = (r: UserRow): AdminUserDto => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  lastActiveAt: toIso(r.lastActiveAt),
  requestsThisMonth: Number(r.requestsThisMonth) || 0,
  maxResultsPerSearch: r.maxResultsPerSearch,
  monthlyRequestLimit: r.monthlyRequestLimit,
});

export const limitDefaults = (): AdminLimitDefaults => ({
  maxResultsPerSearch: env().MAX_RESULTS_PER_SEARCH,
  monthlyRequestLimit: env().MONTHLY_PROVIDER_REQUEST_LIMIT_PER_USER,
});

/** All accounts, people waiting for approval first, then newest first. */
export async function listUsers(opts: { now?: Date } = {}): Promise<AdminUsersResponse> {
  const rows = await selectUsers(db(), opts.now ?? new Date()).orderBy(
    sql`(${user.status} = 'pending') desc`,
    desc(user.createdAt),
    user.id,
  );
  const users = rows.map(toDto);
  return { users, pendingCount: users.filter((u) => u.status === "pending").length, defaults: limitDefaults() };
}

export async function getAdminUser(id: string, tx?: DbOrTx): Promise<AdminUserDto | null> {
  const [row] = await selectUsers(tx ?? db(), new Date()).where(eq(user.id, id)).limit(1);
  return row ? toDto(row) : null;
}

/**
 * Change a user's status, role and/or limits.
 * Rules: you cannot change your own role or status; the last active admin cannot be disabled or
 * demoted; disabling deletes all of the user's sessions. Every change (and every refusal) is audited.
 */
export async function updateUser(
  actor: AppUser,
  targetId: string,
  patch: AdminUserPatch,
  opts: { ip?: string | null } = {},
): Promise<AdminUserDto> {
  const result = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_CHANGE_LOCK})`);

    // The actor's own rights are re-read under the lock (they may have just been demoted).
    const [me] = await tx.select({ role: user.role, status: user.status }).from(user).where(eq(user.id, actor.id)).limit(1);
    if (!me || me.role !== "admin" || me.status !== "active") {
      throw new HttpError("forbidden", "Administrators only");
    }

    const [target] = await tx
      .select({
        id: user.id,
        role: user.role,
        status: user.status,
        maxResultsPerSearch: userSettings.maxResultsPerSearch,
        monthlyRequestLimit: userSettings.monthlyRequestLimit,
      })
      .from(user)
      .leftJoin(userSettings, eq(userSettings.userId, user.id))
      .where(eq(user.id, targetId))
      .limit(1);
    if (!target) throw notFound("User");

    const [{ n: otherActiveAdmins }] = (await tx
      .select({ n: count() })
      .from(user)
      .where(and(eq(user.role, "admin"), eq(user.status, "active"), ne(user.id, targetId)))) as [{ n: number }];

    const plan = planUserChange({ actorId: actor.id, target: target satisfies UserFacts, patch, otherActiveAdmins });
    if (!plan.ok) return { kind: "denied" as const, denied: plan };

    if (Object.keys(plan.userUpdate).length) {
      await tx
        .update(user)
        .set({ ...plan.userUpdate, updatedAt: new Date() })
        .where(eq(user.id, targetId));
    }
    if (Object.keys(plan.limitsUpdate).length) {
      await tx
        .insert(userSettings)
        .values({ userId: targetId, ...plan.limitsUpdate })
        .onConflictDoUpdate({ target: userSettings.userId, set: { ...plan.limitsUpdate, updatedAt: new Date() } });
    }
    let sessionsRevoked = 0;
    if (plan.revokeSessions) {
      const deleted = await tx.delete(session).where(eq(session.userId, targetId)).returning({ id: session.id });
      sessionsRevoked = deleted.length;
      // A disabled account must stop spending: cancel queued searches and ask running ones to stop.
      const stoppedAt = new Date();
      await tx
        .update(searchJobs)
        .set({ status: "cancelled", cancelRequested: true, stopReason: "Cancelled because the account was disabled.", finishedAt: stoppedAt })
        .where(and(eq(searchJobs.userId, targetId), eq(searchJobs.status, "queued")));
      await tx
        .update(searchJobs)
        .set({ cancelRequested: true })
        .where(and(eq(searchJobs.userId, targetId), inArray(searchJobs.status, ["searching", "enriching"])));
    }
    if (Object.keys(plan.after).length) {
      await audit(
        {
          actorId: actor.id,
          action: "admin.user.update",
          resourceType: "user",
          resourceId: targetId,
          metadata: { before: plan.before, after: plan.after, ...(plan.revokeSessions ? { sessionsRevoked } : {}) },
          ip: opts.ip,
        },
        tx,
      );
    }
    const dto = await getAdminUser(targetId, tx);
    if (!dto) throw notFound("User");
    return { kind: "ok" as const, dto };
  });

  if (result.kind === "denied") {
    const { denied } = result;
    await audit({
      actorId: actor.id,
      action: "admin.user.update",
      resourceType: "user",
      resourceId: targetId,
      outcome: "denied",
      metadata: { reason: denied.reason, requested: patch },
      ip: opts.ip,
    });
    throw new HttpError(denied.code, denied.message);
  }
  return result.dto;
}
