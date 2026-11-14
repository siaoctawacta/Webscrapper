import { describe, expect, it } from "vitest";
import { defaultColumns } from "./fields";
import { columnsFor, gridPrefsPatchSchema, mergeGridPrefs, parseStoredGridPrefs } from "./grid-prefs";

describe("gridPrefsPatchSchema", () => {
  it("accepts valid columns, de-duplicates them and keeps order", () => {
    const r = gridPrefsPatchSchema.parse({ results: { columns: ["phone", "business_name", "phone", "email"], pageSize: 100 } });
    expect(r.results).toEqual({ columns: ["phone", "business_name", "email"], pageSize: 100 });
  });

  it("rejects unknown columns and columns from another grid", () => {
    const unknown = gridPrefsPatchSchema.safeParse({ results: { columns: ["business_name", "password"] } });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.issues[0]?.message).toMatch(/Unknown column "password"/);

    const wrongCtx = gridPrefsPatchSchema.safeParse({ results: { columns: ["tags"] } });
    expect(wrongCtx.success).toBe(false);
    expect(wrongCtx.error?.issues[0]?.message).toMatch(/not available in this grid/);

    expect(gridPrefsPatchSchema.safeParse({ collection: { columns: ["tags", "lead_status"] } }).success).toBe(true);
  });

  it("enforces 1..40 columns, valid page sizes, known contexts and a non-empty update", () => {
    expect(gridPrefsPatchSchema.safeParse({ results: { columns: [] } }).success).toBe(false);
    expect(gridPrefsPatchSchema.safeParse({ results: { columns: Array(41).fill("phone") } }).success).toBe(false);
    expect(gridPrefsPatchSchema.safeParse({ results: { pageSize: 30 } }).success).toBe(false);
    expect(gridPrefsPatchSchema.safeParse({ results: {} }).success).toBe(false);
    expect(gridPrefsPatchSchema.safeParse({ other: { columns: ["phone"] } }).success).toBe(false);
    expect(gridPrefsPatchSchema.safeParse({ results: null }).success).toBe(true);
  });
});

describe("mergeGridPrefs", () => {
  it("merges per context and within a context", () => {
    const current = { results: { columns: ["phone" as const], pageSize: 25 as const }, collection: { columns: ["tags" as const] } };
    expect(mergeGridPrefs(current, { results: { columns: ["email"] } })).toEqual({
      results: { columns: ["email"], pageSize: 25 },
      collection: { columns: ["tags"] },
    });
    expect(mergeGridPrefs(current, { collection: { pageSize: 100 } })).toEqual({
      results: { columns: ["phone"], pageSize: 25 },
      collection: { columns: ["tags"], pageSize: 100 },
    });
  });

  it("null resets a context; a page size alone falls back to default columns", () => {
    expect(mergeGridPrefs({ results: { columns: ["phone"] } }, { results: null })).toEqual({});
    expect(mergeGridPrefs({}, { results: { pageSize: 50 } })).toEqual({ results: { columns: defaultColumns("results"), pageSize: 50 } });
  });
});

describe("parseStoredGridPrefs", () => {
  it("drops malformed or outdated entries instead of failing", () => {
    expect(parseStoredGridPrefs(null)).toEqual({});
    expect(parseStoredGridPrefs("x")).toEqual({});
    expect(
      parseStoredGridPrefs({ results: { columns: ["phone", "gone_field", "phone", 3], pageSize: 7 }, collection: "bad", extra: {} }),
    ).toEqual({ results: { columns: ["phone"] } });
    expect(parseStoredGridPrefs({ collection: { columns: ["nope"], pageSize: 100 } })).toEqual({
      collection: { columns: defaultColumns("collection"), pageSize: 100 },
    });
  });

  it("columnsFor falls back to defaults", () => {
    expect(columnsFor({}, "results")).toEqual(defaultColumns("results"));
    expect(columnsFor({ results: { columns: ["email"] } }, "results")).toEqual(["email"]);
  });
});
