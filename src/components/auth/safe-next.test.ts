import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-site relative paths with query and hash", () => {
    expect(safeNextPath("/collections")).toBe("/collections");
    expect(safeNextPath("/searches/123?tab=no_website#grid")).toBe("/searches/123?tab=no_website#grid");
  });

  it("falls back for anything that could leave the site or loop", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "search",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "/\tevil",
      " /search",
      "/sign-in",
      "/sign-in?next=/x",
      "/sign-up",
      "/pending",
      "/api/v1/admin/users",
      ["/collections"],
      "/" + "a".repeat(2001),
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe("/search");
    }
    expect(safeNextPath("//evil.com", "/home")).toBe("/home");
    // Encoded characters stay encoded and on this site.
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});
