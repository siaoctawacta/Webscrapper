/**
 * Multi-column sort helpers for the grid (pure).
 * Header click cycles asc → desc → off; additive (Shift+click) keeps the other keys.
 */
import { FIELDS, type FieldKey } from "@/lib/fields";
import { MAX_SORT_KEYS, type SortDirection, type SortSpec } from "@/lib/list-query";

export { MAX_SORT_KEYS };

const nextDirection = (d: SortDirection | undefined): SortDirection | undefined =>
  d === undefined ? "asc" : d === "asc" ? "desc" : undefined;

export type SortToggleResult = {
  sort: SortSpec[];
  /** True when the click was ignored because MAX_SORT_KEYS keys are already active. */
  limited: boolean;
};

/**
 * Apply a header click.
 * - Plain click: this column becomes the only sort key, cycling asc → desc → off.
 * - Additive (Shift+click): cycle this key in place (removing it after desc) or append it as the
 *   lowest-priority key; ignored (limited = true) when MAX_SORT_KEYS keys are already set.
 */
export function toggleSort(sort: readonly SortSpec[], field: FieldKey, opts: { additive?: boolean } = {}): SortToggleResult {
  const existing = sort.find((s) => s.field === field);
  const next = nextDirection(existing?.direction);
  if (!opts.additive) {
    // A plain click on a column that is one of several keys makes it the sole key, keeping its cycle position.
    return { sort: next ? [{ field, direction: next }] : [], limited: false };
  }
  if (existing) {
    return {
      sort: next ? sort.map((s) => (s.field === field ? { field, direction: next } : s)) : sort.filter((s) => s.field !== field),
      limited: false,
    };
  }
  if (sort.length >= MAX_SORT_KEYS) return { sort: [...sort], limited: true };
  return { sort: [...sort, { field, direction: "asc" }], limited: false };
}

/** Flip the direction of one active key (sort chip click). */
export function flipSort(sort: readonly SortSpec[], field: FieldKey): SortSpec[] {
  return sort.map((s) => (s.field === field ? { field, direction: s.direction === "asc" ? "desc" : "asc" } : s));
}

export function removeSort(sort: readonly SortSpec[], field: FieldKey): SortSpec[] {
  return sort.filter((s) => s.field !== field);
}

/** Append a key ascending ("Add sort" control). No-op if present or at the limit. */
export function addSort(sort: readonly SortSpec[], field: FieldKey, direction: SortDirection = "asc"): SortSpec[] {
  if (sort.some((s) => s.field === field) || sort.length >= MAX_SORT_KEYS) return [...sort];
  return [...sort, { field, direction }];
}

/** Direction and 1-based priority of a column in the current sort, if sorted. */
export function sortStateOf(sort: readonly SortSpec[], field: FieldKey): { direction: SortDirection; priority: number } | null {
  const i = sort.findIndex((s) => s.field === field);
  return i === -1 ? null : { direction: sort[i]!.direction, priority: i + 1 };
}

export const isSortable = (field: FieldKey) => FIELDS[field].sortable;

/** Human description of a sort key, e.g. "Rating, high to low". */
export function describeSort(s: SortSpec): string {
  const def = FIELDS[s.field];
  const asc = s.direction === "asc";
  switch (def.kind) {
    case "number":
      return `${def.label}, ${asc ? "low to high" : "high to low"}`;
    case "date":
      return `${def.label}, ${asc ? "oldest first" : "newest first"}`;
    case "enum":
      return `${def.label}, ${asc ? "ascending" : "descending"}`;
    default:
      return `${def.label}, ${asc ? "A to Z" : "Z to A"}`;
  }
}
