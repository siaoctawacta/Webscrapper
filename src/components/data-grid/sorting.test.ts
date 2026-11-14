import { describe, expect, it } from "vitest";
import type { SortSpec } from "@/lib/list-query";
import { addSort, describeSort, flipSort, MAX_SORT_KEYS, removeSort, sortStateOf, toggleSort } from "./sorting";

describe("toggleSort (plain click)", () => {
  it("cycles asc → desc → off on one column", () => {
    let s: SortSpec[] = [];
    s = toggleSort(s, "rating").sort;
    expect(s).toEqual([{ field: "rating", direction: "asc" }]);
    s = toggleSort(s, "rating").sort;
    expect(s).toEqual([{ field: "rating", direction: "desc" }]);
    s = toggleSort(s, "rating").sort;
    expect(s).toEqual([]);
  });

  it("replaces other keys with the clicked column", () => {
    const s: SortSpec[] = [
      { field: "category", direction: "asc" },
      { field: "rating", direction: "desc" },
    ];
    expect(toggleSort(s, "business_name").sort).toEqual([{ field: "business_name", direction: "asc" }]);
    // clicking a secondary key keeps its cycle position and makes it the only key
    expect(toggleSort(s, "category").sort).toEqual([{ field: "category", direction: "desc" }]);
  });
});

describe("toggleSort (Shift+click)", () => {
  it("appends a new key at the lowest priority", () => {
    const s: SortSpec[] = [{ field: "category", direction: "asc" }];
    const r = toggleSort(s, "rating", { additive: true });
    expect(r.limited).toBe(false);
    expect(r.sort).toEqual([
      { field: "category", direction: "asc" },
      { field: "rating", direction: "asc" },
    ]);
  });

  it("cycles an existing key in place and removes it after desc", () => {
    const s: SortSpec[] = [
      { field: "category", direction: "asc" },
      { field: "rating", direction: "asc" },
    ];
    const once = toggleSort(s, "category", { additive: true }).sort;
    expect(once).toEqual([
      { field: "category", direction: "desc" },
      { field: "rating", direction: "asc" },
    ]);
    expect(toggleSort(once, "category", { additive: true }).sort).toEqual([{ field: "rating", direction: "asc" }]);
  });

  it(`refuses a ${MAX_SORT_KEYS + 1}th key and reports the limit`, () => {
    const s: SortSpec[] = [
      { field: "category", direction: "asc" },
      { field: "rating", direction: "desc" },
      { field: "city", direction: "asc" },
    ];
    const r = toggleSort(s, "business_name", { additive: true });
    expect(r.limited).toBe(true);
    expect(r.sort).toEqual(s);
    // existing keys can still be cycled at the limit
    expect(toggleSort(s, "city", { additive: true }).limited).toBe(false);
  });

  it("does not mutate its input", () => {
    const s: SortSpec[] = [{ field: "rating", direction: "asc" }];
    toggleSort(s, "rating", { additive: true });
    toggleSort(s, "city", { additive: true });
    expect(s).toEqual([{ field: "rating", direction: "asc" }]);
  });
});

describe("chip helpers", () => {
  const s: SortSpec[] = [
    { field: "category", direction: "asc" },
    { field: "rating", direction: "desc" },
  ];
  it("flips and removes keys", () => {
    expect(flipSort(s, "rating")[1]).toEqual({ field: "rating", direction: "asc" });
    expect(removeSort(s, "category")).toEqual([{ field: "rating", direction: "desc" }]);
  });
  it("adds keys up to the limit only, without duplicates", () => {
    expect(addSort(s, "city")).toHaveLength(3);
    expect(addSort(s, "rating")).toEqual(s);
    expect(addSort(addSort(s, "city"), "business_name")).toHaveLength(3);
  });
  it("reports direction and priority", () => {
    expect(sortStateOf(s, "rating")).toEqual({ direction: "desc", priority: 2 });
    expect(sortStateOf(s, "phone")).toBeNull();
  });
  it("describes keys in plain words", () => {
    expect(describeSort({ field: "rating", direction: "desc" })).toBe("Rating, high to low");
    expect(describeSort({ field: "business_name", direction: "asc" })).toBe("Business name, A to Z");
    expect(describeSort({ field: "retrieved_at", direction: "desc" })).toBe("Retrieved, newest first");
  });
});
