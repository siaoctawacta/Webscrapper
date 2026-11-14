import { describe, expect, it } from "vitest";
import { hasListParams, readListQuery, resolveDefaults, sameListQuery, writeListQuery } from "./list-query-url";

const p = (s: string) => new URLSearchParams(s);

describe("readListQuery", () => {
  const defaults = resolveDefaults({ sort: [{ field: "rating", direction: "desc" }], pageSize: 25 });

  it("uses defaults when the URL has no list params", () => {
    const q = readListQuery(p("tab=no_website"), "results", defaults);
    expect(q).toEqual({ page: 1, pageSize: 25, sort: [{ field: "rating", direction: "desc" }], filters: {}, search: undefined });
  });

  it("treats the URL as the full truth once list params exist", () => {
    const q = readListQuery(p("page=3&filter[has_phone]=true"), "results", defaults);
    expect(q.page).toBe(3);
    expect(q.pageSize).toBe(25);
    expect(q.sort).toEqual([]);
    expect(q.filters).toEqual({ has_phone: true });
  });

  it("parses a full query", () => {
    const q = readListQuery(
      p("page=2&page_size=100&sort=category:asc&sort=business_name:desc&filter[category]=Hotel&filter[category]=Lodge&filter[min_rating]=4&search=palm"),
      "results",
      defaults,
    );
    expect(q).toEqual({
      page: 2,
      pageSize: 100,
      sort: [
        { field: "category", direction: "asc" },
        { field: "business_name", direction: "desc" },
      ],
      filters: { category: ["Hotel", "Lodge"], min_rating: 4 },
      search: "palm",
    });
  });

  it("drops invalid pieces individually", () => {
    const q = readListQuery(
      p("page=abc&page_size=7&sort=nope:asc&sort=rating:desc&filter[has_phone]=maybe&filter[city]=Lomé&filter[lead_status]=new&filter[bogus]=1"),
      "results",
      defaults,
    );
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
    expect(q.sort).toEqual([{ field: "rating", direction: "desc" }]);
    // lead_status is collection-only; bogus is unknown; has_phone has a bad value
    expect(q.filters).toEqual({ city: ["Lomé"] });
  });

  it("falls back to the default sort when every sort key is invalid", () => {
    expect(readListQuery(p("sort=nope&page=2"), "results", defaults).sort).toEqual([{ field: "rating", direction: "desc" }]);
  });

  it("accepts collection-only filters in the collection grid", () => {
    expect(readListQuery(p("filter[lead_status]=won&filter[untagged]=1"), "collection", resolveDefaults({})).filters).toEqual({
      lead_status: ["won"],
      untagged: true,
    });
  });
});

describe("writeListQuery", () => {
  const defaults = resolveDefaults({ sort: [{ field: "rating", direction: "desc" }], pageSize: 25 });

  it("keeps unrelated params and omits default page / page size", () => {
    const out = writeListQuery(p("tab=no_website&page=4"), { ...defaults, filters: { has_email: true } }, defaults);
    expect(out.get("tab")).toBe("no_website");
    expect(out.has("page")).toBe(false);
    expect(out.has("page_size")).toBe(false);
    expect(out.get("filter[has_email]")).toBe("true");
    expect(out.getAll("sort")).toEqual(["rating:desc"]);
  });

  it("writes page size when it differs from the defaults (even if it equals 50)", () => {
    expect(writeListQuery(p(""), { ...defaults, pageSize: 50 }, defaults).get("page_size")).toBe("50");
  });

  it("writes nothing for the defaults themselves", () => {
    expect(writeListQuery(p("x=1"), defaults, defaults).toString()).toBe("x=1");
  });

  it("keeps a marker when the user removed the default sort", () => {
    const out = writeListQuery(p(""), { ...defaults, sort: [] }, defaults);
    expect(hasListParams(out)).toBe(true);
    expect(readListQuery(out, "results", defaults).sort).toEqual([]);
  });

  it("round-trips through read", () => {
    const q = { page: 3, pageSize: 100, sort: [{ field: "city" as const, direction: "asc" as const }], filters: { website_status: ["none" as const], hide_duplicates: true }, search: "spa" };
    expect(sameListQuery(readListQuery(writeListQuery(p("tab=all"), q, defaults), "results", defaults), q)).toBe(true);
  });
});
