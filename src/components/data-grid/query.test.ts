import { describe, expect, it } from "vitest";
import { defaultListQuery, type ListQuery } from "@/lib/list-query";
import { applyQueryPatch, matchSignature, pageCount, pageRange, sameFilters } from "./query";

const q = (over: Partial<ListQuery> = {}): ListQuery => ({ ...defaultListQuery(), ...over });

describe("applyQueryPatch", () => {
  it("resets to page 1 when sort, filters, search or page size change", () => {
    const base = q({ page: 4 });
    expect(applyQueryPatch(base, { sort: [{ field: "rating", direction: "desc" }] }).page).toBe(1);
    expect(applyQueryPatch(base, { filters: { has_phone: true } }).page).toBe(1);
    expect(applyQueryPatch(base, { search: "palm" }).page).toBe(1);
    expect(applyQueryPatch(base, { pageSize: 100 }).page).toBe(1);
  });

  it("keeps the page when nothing that affects matching changed", () => {
    const base = q({ page: 4, filters: { city: ["Lomé"] }, search: "palm" });
    expect(applyQueryPatch(base, { filters: { city: ["Lomé"] } }).page).toBe(4);
    expect(applyQueryPatch(base, { search: " palm " }).page).toBe(4);
    expect(applyQueryPatch(base, { page: 2 }).page).toBe(2);
  });

  it("normalizes empty search to undefined", () => {
    expect(applyQueryPatch(q({ search: "x" }), { search: "   " }).search).toBeUndefined();
  });
});

describe("paging", () => {
  it("computes page count and visible range", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(1234, 50)).toBe(25);
    expect(pageRange(1, 50, 1234)).toEqual({ from: 1, to: 50 });
    expect(pageRange(25, 50, 1234)).toEqual({ from: 1201, to: 1234 });
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
    expect(pageRange(30, 50, 1234)).toEqual({ from: 0, to: 0 });
    expect(pageRange(2, 50, 1234, 12)).toEqual({ from: 51, to: 62 });
  });
});

describe("filter comparison", () => {
  it("ignores key order, value order and empty arrays", () => {
    expect(sameFilters({ city: ["a", "b"], has_phone: true }, { has_phone: true, city: ["b", "a"], quality: [] })).toBe(true);
    expect(sameFilters({ has_phone: true }, { has_phone: false })).toBe(false);
    expect(matchSignature({ filters: {}, search: " x " })).toBe(matchSignature({ filters: {}, search: "x" }));
  });
});
