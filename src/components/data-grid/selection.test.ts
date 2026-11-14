import { describe, expect, it, vi } from "vitest";
import {
  clearSelection,
  emptySelection,
  explicitIds,
  isSelected,
  pageSelectionState,
  resolveSelectionIds,
  selectAllFiltered,
  selectionCount,
  setSelected,
  toggle,
  type GridSelection,
} from "./selection";

describe("ids mode", () => {
  it("toggles ids on and off", () => {
    let s = emptySelection();
    s = toggle(s, "a");
    s = toggle(s, "b");
    expect(isSelected(s, "a")).toBe(true);
    expect(selectionCount(s, 100)).toBe(2);
    s = toggle(s, "a");
    expect(isSelected(s, "a")).toBe(false);
    expect(s).toEqual({ mode: "ids", ids: ["b"] });
  });

  it("selects and deselects a page without duplicates", () => {
    let s: GridSelection = { mode: "ids", ids: ["a"] };
    s = setSelected(s, ["a", "b", "c"], true);
    expect(s).toEqual({ mode: "ids", ids: ["a", "b", "c"] });
    s = setSelected(s, ["b", "c"], false);
    expect(s).toEqual({ mode: "ids", ids: ["a"] });
  });

  it("returns the same object when nothing changes", () => {
    const s: GridSelection = { mode: "ids", ids: ["a"] };
    expect(setSelected(s, ["a"], true)).toBe(s);
    expect(setSelected(s, ["z"], false)).toBe(s);
  });
});

describe("all_filtered mode", () => {
  it("counts total minus exclusions", () => {
    let s = selectAllFiltered();
    expect(selectionCount(s, 1234)).toBe(1234);
    s = toggle(s, "x");
    expect(isSelected(s, "x")).toBe(false);
    expect(isSelected(s, "y")).toBe(true);
    expect(selectionCount(s, 1234)).toBe(1233);
    s = toggle(s, "x");
    expect(s).toEqual({ mode: "all_filtered", excludedIds: [] });
  });

  it("deselecting a page adds its rows to the exclusions", () => {
    const s = setSelected(selectAllFiltered(), ["a", "b"], false);
    expect(s).toEqual({ mode: "all_filtered", excludedIds: ["a", "b"] });
    expect(setSelected(s, ["a"], true)).toEqual({ mode: "all_filtered", excludedIds: ["b"] });
  });

  it("never reports a negative count", () => {
    expect(selectionCount({ mode: "all_filtered", excludedIds: ["a", "b"] }, 1)).toBe(0);
  });
});

describe("pageSelectionState", () => {
  it("is false / indeterminate / true", () => {
    const page = ["a", "b", "c"];
    expect(pageSelectionState(emptySelection(), page)).toBe(false);
    expect(pageSelectionState({ mode: "ids", ids: ["b"] }, page)).toBe("indeterminate");
    expect(pageSelectionState({ mode: "ids", ids: ["a", "b", "c", "z"] }, page)).toBe(true);
    expect(pageSelectionState(selectAllFiltered(), page)).toBe(true);
    expect(pageSelectionState({ mode: "all_filtered", excludedIds: ["a"] }, page)).toBe("indeterminate");
    expect(pageSelectionState(selectAllFiltered(), [])).toBe(false);
  });
});

describe("resolving ids", () => {
  it("returns explicit ids without fetching", async () => {
    const fetchAll = vi.fn(async () => ["nope"]);
    expect(await resolveSelectionIds({ mode: "ids", ids: ["a"] }, fetchAll)).toEqual(["a"]);
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it("fetches all ids and removes exclusions in all_filtered mode", async () => {
    const fetchAll = vi.fn(async () => ["a", "b", "c"]);
    expect(await resolveSelectionIds({ mode: "all_filtered", excludedIds: ["b"] }, fetchAll)).toEqual(["a", "c"]);
  });

  it("explicitIds is null only for all_filtered", () => {
    expect(explicitIds({ mode: "ids", ids: ["a"] })).toEqual(["a"]);
    expect(explicitIds(selectAllFiltered())).toBeNull();
  });

  it("clearSelection resets to an empty ids selection", () => {
    expect(clearSelection()).toEqual({ mode: "ids", ids: [] });
  });
});
