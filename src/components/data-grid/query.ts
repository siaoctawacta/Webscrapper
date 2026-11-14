/**
 * ListQuery helpers used by the grid (pure).
 */
import { DEFAULT_PAGE_SIZE, type Filters, type ListQuery, type SortSpec } from "@/lib/list-query";

const sameSort = (a: readonly SortSpec[], b: readonly SortSpec[]) =>
  a.length === b.length && a.every((s, i) => s.field === b[i]!.field && s.direction === b[i]!.direction);

/** Order-insensitive structural comparison of two filter objects (empty arrays = absent). */
export function sameFilters(a: Filters, b: Filters): boolean {
  return stableFilterKey(a) === stableFilterKey(b);
}

export function stableFilterKey(f: Filters): string {
  const entries = Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

const normSearch = (s: string | undefined) => (s ?? "").trim();

/**
 * Merge a partial change into a query. Any change to sort, filters, search or page size sends the
 * user back to page 1 (unless the patch sets `page` explicitly).
 */
export function applyQueryPatch(q: ListQuery, patch: Partial<ListQuery>): ListQuery {
  const next: ListQuery = { ...q, ...patch };
  if ("search" in patch) next.search = normSearch(patch.search) || undefined;
  const resets =
    ("sort" in patch && !sameSort(q.sort, next.sort)) ||
    ("filters" in patch && !sameFilters(q.filters, next.filters)) ||
    ("search" in patch && normSearch(q.search) !== normSearch(next.search)) ||
    ("pageSize" in patch && q.pageSize !== next.pageSize);
  if (resets && !("page" in patch)) next.page = 1;
  return next;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize || DEFAULT_PAGE_SIZE)));
}

/** 1-based inclusive range of rows shown on a page ("Showing 51–100 of 1,234"). */
export function pageRange(page: number, pageSize: number, total: number, rowsOnPage?: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  const to = rowsOnPage != null ? from + rowsOnPage - 1 : Math.min(total, page * pageSize);
  return from > total ? { from: 0, to: 0 } : { from, to: Math.min(to, total) };
}

/** Signature of the parts of a query that define *which* rows match (not page/sort). */
export const matchSignature = (q: Pick<ListQuery, "filters" | "search">) => `${stableFilterKey(q.filters)}|${normSearch(q.search)}`;
