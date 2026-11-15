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

import { signInErrorMessage, signUpErrorMessage } from "./auth-messages";

describe("auth error messages", () => {
  it("uses the server's wait time for rate limits and explains server problems", () => {
    expect(signInErrorMessage({ status: 429, message: "Too many sign-in attempts for this account. Wait 15 minutes and try again." })).toMatch(/15 minutes/);
    expect(signInErrorMessage({ status: 429 })).toMatch(/Wait a minute/);
    expect(signInErrorMessage({ status: 500, message: "Internal Server Error" })).toMatch(/problem on the server/);
    expect(signUpErrorMessage({ status: 503 })).toMatch(/problem on the server/);
    expect(signInErrorMessage({ status: 401 })).toMatch(/don't match/);
  });
});
