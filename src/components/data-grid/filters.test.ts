import { describe, expect, it } from "vitest";
import type { Filters } from "@/lib/list-query";
import {
  clearFilters,
  countActiveFilters,
  deriveFilterChips,
  removeFilterChip,
  setCategoryMode,
  setFilter,
  toggleFilterValue,
  triStateOf,
  triStateValue,
} from "./filters";

describe("deriveFilterChips", () => {
  it("creates readable chips for every kind of filter", () => {
    const filters: Filters = {
      has_phone: true,
      has_website: false,
      category: ["Hotel", "Lodge"],
      exclude_category: ["Restaurant"],
      min_rating: 4,
      max_reviews: 1500,
      website_status: ["none"],
      email_status: ["source_provided"],
      quality: ["duplicate_candidate"],
      hide_duplicates: true,
      name_contains: "palm",
    };
    expect(deriveFilterChips(filters).map((c) => c.label)).toEqual([
      "Has phone",
      "No website",
      "Category: Hotel",
      "Category: Lodge",
      "Excluding: Restaurant",
      "Rating ≥ 4",
      "≤ 1,500 reviews",
      "Quality: Possible duplicate",
      "Website: No website",
      "Email: Source-provided",
      "Name contains “palm”",
      "Duplicates hidden",
    ]);
  });

  it("labels collection-only filters", () => {
    const chips = deriveFilterChips({ lead_status: ["proposal_sent"], tag: ["VIP"], untagged: true });
    expect(chips.map((c) => c.label)).toEqual(["Status: Proposal sent", "Tag: VIP", "Untagged only"]);
  });

  it("skips excluded (page-controlled) filters, empty arrays and no-op booleans", () => {
    const filters: Filters = { has_website: false, city: [], hide_duplicates: false, has_email: true };
    expect(deriveFilterChips(filters, { exclude: ["has_website"] }).map((c) => c.id)).toEqual(["has_email"]);
    expect(countActiveFilters(filters, { exclude: ["has_website"] })).toBe(1);
  });

  it("gives chips stable unique ids", () => {
    const ids = deriveFilterChips({ city: ["Lomé", "Kpalimé"], has_phone: true }).map((c) => c.id);
    expect(ids).toEqual(["has_phone", "city:Lomé", "city:Kpalimé"]);
  });
});

describe("removeFilterChip", () => {
  it("removes one value of a multi filter and drops the key when empty", () => {
    let f: Filters = { category: ["Hotel", "Lodge"], has_phone: true };
    const [, hotel] = deriveFilterChips(f);
    f = removeFilterChip(f, hotel!);
    expect(f).toEqual({ category: ["Lodge"], has_phone: true });
    f = removeFilterChip(f, { filter: "category", value: "Lodge" });
    expect(f).toEqual({ has_phone: true });
  });

  it("removes scalar filters entirely", () => {
    expect(removeFilterChip({ min_rating: 4, has_phone: false }, { filter: "has_phone" })).toEqual({ min_rating: 4 });
  });
});

describe("updates", () => {
  it("setFilter removes blank values", () => {
    expect(setFilter({ min_rating: 3 }, "min_rating", undefined)).toEqual({});
    expect(setFilter({}, "city", [])).toEqual({});
    expect(setFilter({}, "name_contains", "  ")).toEqual({});
    expect(setFilter({}, "has_email", false)).toEqual({ has_email: false });
  });

  it("toggleFilterValue adds and removes values", () => {
    let f = toggleFilterValue({}, "quality", "complete");
    expect(f).toEqual({ quality: ["complete"] });
    f = toggleFilterValue(f, "quality", "complete");
    expect(f).toEqual({});
  });

  it("tri-state round-trips", () => {
    expect(triStateOf(undefined)).toBe("any");
    expect(triStateOf(true)).toBe("has");
    expect(triStateOf(false)).toBe("missing");
    expect(triStateValue("missing")).toBe(false);
    expect(triStateValue("any")).toBeUndefined();
  });

  it("clearFilters keeps only page-controlled filters", () => {
    expect(clearFilters({ has_website: false, city: ["Lomé"], min_rating: 4 }, ["has_website"])).toEqual({ has_website: false });
    expect(clearFilters({ city: ["Lomé"] })).toEqual({});
  });

  it("setCategoryMode moves selected categories between include and exclude", () => {
    const f: Filters = { category: ["Hotel"], has_phone: true };
    const ex = setCategoryMode(f, "exclude");
    expect(ex).toEqual({ exclude_category: ["Hotel"], has_phone: true });
    expect(setCategoryMode(ex, "include")).toEqual(f);
    expect(setCategoryMode({ has_phone: true }, "exclude")).toEqual({ has_phone: true });
  });
});
