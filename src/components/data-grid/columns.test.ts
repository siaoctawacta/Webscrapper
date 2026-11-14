import { describe, expect, it } from "vitest";
import { defaultColumns, type FieldKey } from "@/lib/fields";
import { canMoveColumn, hiddenColumns, moveColumn, normalizeColumns, resetColumns, toggleColumn } from "./columns";

describe("normalizeColumns", () => {
  it("drops unknown, duplicate and out-of-context keys and pins business_name first", () => {
    expect(normalizeColumns(["phone", "nope", "phone", "lead_status", 42, "business_name"], "results")).toEqual(["business_name", "phone"]);
  });
  it("keeps collection-only fields in the collection grid", () => {
    expect(normalizeColumns(["tags", "lead_status"], "collection")).toEqual(["business_name", "tags", "lead_status"]);
  });
  it("handles empty input", () => {
    expect(normalizeColumns(undefined, "results")).toEqual(["business_name"]);
  });
  it("reset returns the registry defaults", () => {
    expect(resetColumns("results")).toEqual(defaultColumns("results"));
    expect(resetColumns("results")[0]).toBe("business_name");
  });
});

describe("toggleColumn", () => {
  const cols: FieldKey[] = ["business_name", "phone", "email", "rating"];
  it("hides a visible column", () => {
    expect(toggleColumn(cols, "email", "results")).toEqual(["business_name", "phone", "rating"]);
  });
  it("never hides the pinned column", () => {
    expect(toggleColumn(cols, "business_name", "results")).toEqual(cols);
  });
  it("inserts a shown column after its closest visible registry predecessor", () => {
    // website comes after phone in the registry
    expect(toggleColumn(cols, "website", "results")).toEqual(["business_name", "phone", "website", "email", "rating"]);
    // review_count comes after rating
    expect(toggleColumn(cols, "review_count", "results")).toEqual(["business_name", "phone", "email", "rating", "review_count"]);
    // category has only business_name before it
    expect(toggleColumn(cols, "category", "results")).toEqual(["business_name", "category", "phone", "email", "rating"]);
  });
  it("respects a custom order when inserting", () => {
    const custom: FieldKey[] = ["business_name", "rating", "phone"];
    expect(toggleColumn(custom, "website", "results")).toEqual(["business_name", "rating", "phone", "website"]);
  });
});

describe("moveColumn", () => {
  const cols: FieldKey[] = ["business_name", "phone", "email", "rating"];
  it("moves a column up and down", () => {
    expect(moveColumn(cols, "email", -1)).toEqual(["business_name", "email", "phone", "rating"]);
    expect(moveColumn(cols, "email", 1)).toEqual(["business_name", "phone", "rating", "email"]);
  });
  it("cannot move above the pinned column or past the end", () => {
    expect(canMoveColumn(cols, "phone", -1)).toBe(false);
    expect(moveColumn(cols, "phone", -1)).toEqual(cols);
    expect(canMoveColumn(cols, "rating", 1)).toBe(false);
    expect(canMoveColumn(cols, "business_name", 1)).toBe(false);
    expect(moveColumn(cols, "business_name", 1)).toEqual(cols);
  });
  it("lists hidden columns in registry order", () => {
    const hidden = hiddenColumns(cols, "results");
    expect(hidden).not.toContain("phone");
    expect(hidden.indexOf("website")).toBeLessThan(hidden.indexOf("address"));
    expect(hidden).not.toContain("lead_status");
  });
});
