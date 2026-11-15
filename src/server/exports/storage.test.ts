import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { deleteExportFile, openExportFile, resolveStorageKey, storageKeyFor, storageRoot, writeExportFile } from "./storage";
import { useTempStorage } from "./test-fixtures";

const EXPORT_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
let storage: Awaited<ReturnType<typeof useTempStorage>>;
beforeAll(async () => {
  storage = await useTempStorage();
});
afterAll(async () => storage.cleanup());

describe("export storage", () => {
  it("uses <base>/<userId>/<exportId>.<ext>", () => {
    expect(storageRoot()).toBe(path.resolve(storage.dir));
    expect(storageKeyFor("user_AbC-123", EXPORT_ID, "xlsx")).toBe(`user_AbC-123/${EXPORT_ID}.xlsx`);
    expect(resolveStorageKey(`u1/${EXPORT_ID}.csv`)).toBe(path.join(storage.dir, "u1", `${EXPORT_ID}.csv`));
  });

  it("refuses ids and keys that could escape the storage directory", () => {
    expect(() => storageKeyFor("../etc", EXPORT_ID, "csv")).toThrow();
    expect(() => storageKeyFor("a/b", EXPORT_ID, "csv")).toThrow();
    expect(() => storageKeyFor("u1", "../../passwd", "csv")).toThrow();
    expect(() => resolveStorageKey("../outside.csv")).toThrow();
    expect(() => resolveStorageKey("/etc/passwd")).toThrow();
    expect(() => resolveStorageKey("")).toThrow();
  });

  it("writes atomically, streams back and deletes", async () => {
    const key = storageKeyFor("u1", EXPORT_ID, "csv");
    await writeExportFile(key, Buffer.from("first"));
    await writeExportFile(key, Buffer.from("second, longer"));
    expect(await readFile(resolveStorageKey(key), "utf8")).toBe("second, longer");
    expect(await readdir(path.join(storage.dir, "u1"))).toEqual([`${EXPORT_ID}.csv`]); // no temp files left

    const file = await openExportFile(key);
    expect(file?.size).toBe(14);
    expect(await new Response(file!.stream).text()).toBe("second, longer");

    expect(await deleteExportFile(key)).toBe(true);
    expect(await deleteExportFile(key)).toBe(false);
    expect(await openExportFile(key)).toBeNull();
  });
});
