import "server-only";
import { count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { likeEscape } from "../db/list-sql";
import { auditLogs, user } from "../db/schema";
import { AUDIT_PAGE_SIZE, type AuditQuery } from "./schemas";
import type { AuditEntryDto, AuditLogResponse } from "./types";

/** Action families used across the app (see each module's audit calls). */
export const KNOWN_AUDIT_PREFIXES = [
  "admin",
  "admin.invitation",
  "admin.user",
  "collection",
  "concept",
  "export",
  "lead",
  "proposal",
  "search",
  "settings",
] as const;

/** `action` equals the prefix or starts with "<prefix>.". The prefix is bound as a parameter. */
export function actionPrefixCondition(prefix: string): SQL {
  return or(eq(auditLogs.action, prefix), sql`${auditLogs.action} like ${likeEscape(prefix) + ".%"}`)!;
}

/** Prefixes for the filter: the known families plus those seen in recent entries ("a" and "a.b"). */
async function availablePrefixes(): Promise<string[]> {
  const recent = await db().execute<{ action: string }>(
    sql`select distinct action from (select ${auditLogs.action} as action from ${auditLogs} order by ${auditLogs.id} desc limit 5000) t`,
  );
  const set = new Set<string>(KNOWN_AUDIT_PREFIXES);
  for (const { action } of recent.rows) {
    const parts = action.split(".");
    if (parts.length > 1) set.add(parts[0]!);
    if (parts.length > 2) set.add(`${parts[0]}.${parts[1]}`);
  }
  return [...set].sort();
}

/** Audit log, newest first, 50 per page, optionally filtered by action prefix. */
export async function listAuditLog(query: AuditQuery): Promise<AuditLogResponse> {
  const page = query.page;
  const where = query.action ? actionPrefixCondition(query.action) : undefined;

  const [rows, [totalRow], prefixes] = await Promise.all([
    db()
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        actorId: auditLogs.actorId,
        actorName: user.name,
        actorEmail: user.email,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        outcome: auditLogs.outcome,
        metadata: auditLogs.metadata,
        ip: auditLogs.ip,
      })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
    db().select({ n: count() }).from(auditLogs).where(where),
    availablePrefixes(),
  ]);

  const entries: AuditEntryDto[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actorId: r.actorId,
    actor: r.actorId && r.actorEmail ? { name: r.actorName ?? "", email: r.actorEmail } : null,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    outcome: r.outcome,
    metadata: r.metadata ?? {},
    ip: r.ip,
  }));

  return { entries, total: totalRow?.n ?? 0, page, pageSize: AUDIT_PAGE_SIZE, prefixes };
}
