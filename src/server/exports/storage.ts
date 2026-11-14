import "server-only";
/**
 * Export file storage on local disk: EXPORT_STORAGE_DIR/<userId>/<exportId>.<ext>.
 * Paths are built only from validated ids and checked to stay inside the base directory.
 * Writes are atomic (temporary file + rename), so a download never sees a half-written file.
 */
import { randomUUID } from "node:crypto";
import { open, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ExportFormat } from "@/lib/domain";
import { env } from "../env";

const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Files this module creates: "<uuid>.xlsx", "<uuid>.csv" and their temporary siblings. */
const OWN_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(xlsx|csv)(\.[0-9a-f-]{36}\.tmp)?$/i;

export function storageRoot(): string {
  return path.resolve(env().EXPORT_STORAGE_DIR);
}

export function storageKeyFor(userId: string, exportId: string, format: ExportFormat): string {
  if (!USER_ID_RE.test(userId)) throw new Error("Invalid user id for export storage");
  if (!UUID_RE.test(exportId)) throw new Error("Invalid export id for export storage");
  return `${userId}/${exportId.toLowerCase()}.${format}`;
}

/** Absolute path of a storage key; throws if it would leave the storage directory. */
export function resolveStorageKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Export path is outside the storage directory");
  return full;
}

const isNotFound = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code === "ENOENT";

export async function writeExportFile(key: string, data: Buffer): Promise<void> {
  const full = resolveStorageKey(key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  const tmp = `${full}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data, { flag: "wx", mode: 0o600 });
    await rename(tmp, full);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Delete a stored file. Returns false when it was already gone. */
export async function deleteExportFile(key: string): Promise<boolean> {
  try {
    await unlink(resolveStorageKey(key));
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

/** Open a stored file for streaming, or null when it no longer exists. */
export async function openExportFile(key: string): Promise<{ size: number; stream: ReadableStream<Uint8Array> } | null> {
  const full = resolveStorageKey(key);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(full, "r");
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) {
      await handle.close();
      return null;
    }
    const nodeStream = handle.createReadStream({ autoClose: true });
    return { size: st.size, stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array> };
  } catch (e) {
    await handle.close().catch(() => undefined);
    throw e;
  }
}

/**
 * Remove export files (and leftover temporary files) last modified before `olderThan`, e.g. files
 * whose export row was deleted with its user. Only touches file names this module creates.
 */
export async function sweepStaleFiles(olderThan: Date): Promise<number> {
  const root = storageRoot();
  let users: string[];
  try {
    users = await readdir(root);
  } catch (e) {
    if (isNotFound(e)) return 0;
    throw e;
  }
  let removed = 0;
  for (const u of users) {
    if (!USER_ID_RE.test(u)) continue;
    const dir = path.join(root, u);
    let files: string[];
    try {
      if (!(await stat(dir)).isDirectory()) continue;
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!OWN_FILE_RE.test(f)) continue;
      const full = path.join(dir, f);
      try {
        const st = await stat(full);
        if (st.isFile() && st.mtime < olderThan) {
          await unlink(full);
          removed += 1;
        }
      } catch (e) {
        if (!isNotFound(e)) console.error("[exports] could not remove stale file", full, e);
      }
    }
  }
  return removed;
}
