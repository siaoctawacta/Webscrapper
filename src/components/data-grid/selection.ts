/**
 * Grid selection model (pure). Two modes:
 *  - `ids`:          an explicit list of selected row ids (can span pages);
 *  - `all_filtered`: every row matching the current query, minus `excludedIds`.
 * All helpers return new objects (never mutate) so they can be used directly as React state.
 */
import { MAX_BULK_ROWS } from "@/lib/list-query";

export type GridSelection = { mode: "ids"; ids: string[] } | { mode: "all_filtered"; excludedIds: string[] };

export const emptySelection = (): GridSelection => ({ mode: "ids", ids: [] });

/** Alias kept for readability at call sites: `onSelectionChange(clearSelection())`. */
export const clearSelection = emptySelection;

export const selectAllFiltered = (): GridSelection => ({ mode: "all_filtered", excludedIds: [] });

export function isSelected(sel: GridSelection, id: string): boolean {
  return sel.mode === "ids" ? sel.ids.includes(id) : !sel.excludedIds.includes(id);
}

/** Select or deselect a set of ids (e.g. the current page). */
export function setSelected(sel: GridSelection, ids: readonly string[], selected: boolean): GridSelection {
  if (sel.mode === "ids") {
    if (selected) {
      const set = new Set(sel.ids);
      const added = ids.filter((id) => !set.has(id));
      return added.length ? { mode: "ids", ids: [...sel.ids, ...added] } : sel;
    }
    const remove = new Set(ids);
    const next = sel.ids.filter((id) => !remove.has(id));
    return next.length === sel.ids.length ? sel : { mode: "ids", ids: next };
  }
  if (selected) {
    const include = new Set(ids);
    const next = sel.excludedIds.filter((id) => !include.has(id));
    return next.length === sel.excludedIds.length ? sel : { mode: "all_filtered", excludedIds: next };
  }
  const set = new Set(sel.excludedIds);
  const added = ids.filter((id) => !set.has(id));
  return added.length ? { mode: "all_filtered", excludedIds: [...sel.excludedIds, ...added] } : sel;
}

export function toggle(sel: GridSelection, id: string): GridSelection {
  return setSelected(sel, [id], !isSelected(sel, id));
}

/** Number of selected rows given the total number of rows matching the query. */
export function selectionCount(sel: GridSelection, total: number): number {
  if (sel.mode === "ids") return sel.ids.length;
  return Math.max(0, total - sel.excludedIds.length);
}

export const hasSelection = (sel: GridSelection, total: number) => selectionCount(sel, total) > 0;

/** Header-checkbox state for the rows currently on screen. */
export function pageSelectionState(sel: GridSelection, pageIds: readonly string[]): boolean | "indeterminate" {
  if (pageIds.length === 0) return false;
  const n = pageIds.reduce((acc, id) => acc + (isSelected(sel, id) ? 1 : 0), 0);
  if (n === 0) return false;
  return n === pageIds.length ? true : "indeterminate";
}

/**
 * Explicit ids when they are known without asking the server, else null:
 * null means "every row matching the query" (all_filtered with no exclusions), which callers can
 * send to the API as `{ query }`.
 */
export function explicitIds(sel: GridSelection): string[] | null {
  if (sel.mode === "ids") return sel.ids;
  return null;
}

/**
 * Resolve the selection to concrete ids. For `all_filtered` this calls `fetchAllIds` (e.g.
 * GET …/results/ids with the current query) and removes the exclusions.
 */
export async function resolveSelectionIds(
  sel: GridSelection,
  fetchAllIds: () => Promise<string[]>,
): Promise<string[]> {
  if (sel.mode === "ids") return sel.ids;
  const all = await fetchAllIds();
  if (!sel.excludedIds.length) return all;
  const excluded = new Set(sel.excludedIds);
  return all.filter((id) => !excluded.has(id));
}

/** Whether a selection of this size exceeds what bulk actions/exports accept. */
export const exceedsBulkLimit = (count: number) => count > MAX_BULK_ROWS;
