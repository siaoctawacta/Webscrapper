import "server-only";
import { and, asc, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "../db";
import { exportsTable } from "../db/schema";
import { FILE_RETENTION_HOURS } from "./shared";
import { deleteExportFile, sweepStaleFiles } from "./storage";

const BATCH = 500;

/** Delete export files past expires_at and mark those exports "expired". Returns how many were purged. */
export async function purgeExpiredExports(now: Date = new Date()): Promise<number> {
  let purged = 0;
  for (;;) {
    const due = await db()
      .select({ id: exportsTable.id, storageKey: exportsTable.storageKey })
      .from(exportsTable)
      .where(and(isNotNull(exportsTable.expiresAt), lte(exportsTable.expiresAt, now), ne(exportsTable.status, "expired")))
      .orderBy(asc(exportsTable.expiresAt))
      .limit(BATCH);
    if (!due.length) break;

    const done: string[] = [];
    for (const row of due) {
      try {
        if (row.storageKey) await deleteExportFile(row.storageKey);
        done.push(row.id);
      } catch (e) {
        // Leave the row as is; the next run retries. Never let one bad file stop the cleanup.
        console.error("[exports] could not delete export file", row.id, e);
      }
    }
    if (done.length) {
      await db()
        .update(exportsTable)
        .set({ status: "expired", storageKey: null, downloadTokenHash: null, downloadTokenExpiresAt: null })
        .where(inArray(exportsTable.id, done));
      purged += done.length;
    }
    if (done.length < due.length || due.length < BATCH) break;
  }

  // Files whose export row is gone (e.g. the user was deleted) or temp files left by a crash.
  try {
    await sweepStaleFiles(new Date(now.getTime() - (FILE_RETENTION_HOURS + 1) * 3600_000));
  } catch (e) {
    console.error("[exports] stale file sweep failed", e);
  }
  return purged;
}
