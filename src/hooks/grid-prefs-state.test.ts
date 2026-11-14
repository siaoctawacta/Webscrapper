import { describe, expect, it } from "vitest";
import { defaultColumns } from "@/lib/fields";
import { gridPrefsStorageKey, parseLocalGridPrefs, resolveGridPrefs } from "./grid-prefs-state";

describe("parseLocalGridPrefs", () => {
  it("parses a saved copy and drops invalid columns", () => {
    expect(parseLocalGridPrefs(JSON.stringify({ columns: ["phone", "nope", "business_name"], pageSize: 25 }), "results")).toEqual({
      columns: ["phone", "business_name"],
      pageSize: 25,
    });
  });
  it("returns null for missing or broken data", () => {
    expect(parseLocalGridPrefs(null, "results")).toBeNull();
    expect(parseLocalGridPrefs("{not json", "results")).toBeNull();
    expect(parseLocalGridPrefs(JSON.stringify({ columns: ["nope"] }), "results")).toBeNull();
  });
  it("uses one key per context", () => {
    expect(gridPrefsStorageKey("collection")).toBe("leadfinder.grid.collection");
  });
});

describe("resolveGridPrefs", () => {
  const server = { columns: ["phone" as const, "business_name" as const], pageSize: 100 as const };
  const local = { columns: ["email" as const] };
  it("prefers session edits, then server, then local, then defaults", () => {
    expect(resolveGridPrefs({ context: "results", session: { columns: ["rating"] }, server, local })).toEqual({
      columns: ["business_name", "rating"],
      pageSize: undefined,
      source: "session",
    });
    expect(resolveGridPrefs({ context: "results", server, local })).toEqual({ columns: ["business_name", "phone"], pageSize: 100, source: "server" });
    expect(resolveGridPrefs({ context: "results", local }).source).toBe("local");
    expect(resolveGridPrefs({ context: "results" })).toEqual({ columns: defaultColumns("results"), pageSize: undefined, source: "default" });
  });
});
