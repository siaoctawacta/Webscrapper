import "server-only";
import { db, type DbOrTx } from "./db";
import { auditLogs } from "./db/schema";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: "success" | "denied" | "error";
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/** Append an audit event. Never throws (auditing must not break the request). */
export async function audit(entry: AuditEntry, tx?: DbOrTx) {
  try {
    await (tx ?? db()).insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome ?? "success",
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
    });
  } catch (e) {
    console.error("[audit] failed to record", entry.action, e);
  }
}
