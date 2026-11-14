/**
 * Reading/writing a ListQuery from/to URL search params, leniently (pure, isomorphic).
 *
 * Rules:
 *  - If the URL has no list params at all (page, page_size, sort, search, filter[...]), the
 *    defaults apply (e.g. a default sort on a first visit).
 *  - Otherwise the URL is the full truth: a missing sort means "no sort", missing filters mean
 *    "no filters", a missing page_size means the default page size.
 *  - Invalid pieces (unknown sort field, bad filter value, page=abc…) are dropped individually and
 *    fall back to defaults, so one bad parameter never breaks the page.
 *  - Unrelated params (e.g. `tab=no_website`) are preserved when writing.
 */
import type { FieldContext } from "@/lib/fields";
import {
  DEFAULT_PAGE_SIZE,
  MAX_SORT_KEYS,
  PAGE_SIZES,
  defaultListQuery,
  parseListQuery,
  serializeListQuery,
  validateFilters,
  validateSort,
  ListQueryError,
  type Filters,
  type ListQuery,
  type SortSpec,
} from "@/lib/list-query";
import { stableFilterKey } from "@/components/data-grid/query";

const isListParam = (key: string) =>
  key === "page" || key === "page_size" || key === "sort" || key === "search" || key.startsWith("filter");

export function hasListParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) if (isListParam(key)) return true;
  return false;
}

/** Complete a partial defaults object. */
export function resolveDefaults(defaults: Partial<ListQuery> | undefined): ListQuery {
  const base = defaultListQuery();
  const pageSize = defaults?.pageSize && (PAGE_SIZES as readonly number[]).includes(defaults.pageSize) ? defaults.pageSize : base.pageSize;
  return {
    page: 1,
    pageSize,
    sort: defaults?.sort ? [...defaults.sort] : [],
    filters: defaults?.filters ? { ...defaults.filters } : {},
    search: defaults?.search?.trim() || undefined,
  };
}

export function sameListQuery(a: ListQuery, b: ListQuery): boolean {
  return (
    a.page === b.page &&
    a.pageSize === b.pageSize &&
    (a.search ?? "") === (b.search ?? "") &&
    a.sort.length === b.sort.length &&
    a.sort.every((s, i) => s.field === b.sort[i]!.field && s.direction === b.sort[i]!.direction) &&
    stableFilterKey(a.filters) === stableFilterKey(b.filters)
  );
}

const cloneQuery = (q: ListQuery): ListQuery => ({ ...q, sort: [...q.sort], filters: { ...q.filters } });

function lenientSort(raw: string[], ctx: FieldContext): SortSpec[] {
  const out: SortSpec[] = [];
  for (const item of raw) {
    try {
      const [s] = validateSort([item], ctx);
      if (s && !out.some((o) => o.field === s.field)) out.push(s);
    } catch (e) {
      if (!(e instanceof ListQueryError)) throw e;
    }
    if (out.length >= MAX_SORT_KEYS) break;
  }
  return out;
}

function lenientFilters(params: URLSearchParams, ctx: FieldContext): Filters {
  const names = new Set<string>();
  for (const key of params.keys()) {
    const m = /^filter\[([a-z_]+)\]$/.exec(key);
    if (m) names.add(m[1]!);
  }
  let out: Filters = {};
  for (const name of names) {
    const single = new URLSearchParams();
    for (const v of params.getAll(`filter[${name}]`)) single.append(`filter[${name}]`, v);
    try {
      const parsed = parseListQuery(single, ctx).filters;
      out = { ...out, ...validateFilters(parsed, ctx) };
    } catch (e) {
      if (!(e instanceof ListQueryError)) throw e;
    }
  }
  return out;
}

/** Parse the URL into a ListQuery, falling back to defaults for anything missing or invalid. */
export function readListQuery(params: URLSearchParams, ctx: FieldContext, defaults: ListQuery): ListQuery {
  if (!hasListParams(params)) return cloneQuery(defaults);
  const withSize = new URLSearchParams(params);
  if (!withSize.has("page_size")) withSize.set("page_size", String(defaults.pageSize));
  try {
    return parseListQuery(withSize, ctx);
  } catch (e) {
    if (!(e instanceof ListQueryError)) throw e;
  }
  const pageNum = Number(params.get("page") ?? 1);
  const sizeNum = Number(params.get("page_size") ?? defaults.pageSize);
  const sortRaw = params.getAll("sort");
  const sort = lenientSort(sortRaw, ctx);
  return {
    page: Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= 100000 ? pageNum : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(sizeNum) ? sizeNum : defaults.pageSize,
    sort: sortRaw.length > 0 && sort.length === 0 ? [...defaults.sort] : sort,
    filters: lenientFilters(params, ctx),
    search: params.get("search")?.trim().slice(0, 200) || undefined,
  };
}

/** Write a ListQuery into a copy of `current`, keeping unrelated params. */
export function writeListQuery(current: URLSearchParams, q: ListQuery, defaults: ListQuery): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of current.entries()) if (!isListParam(k)) out.append(k, v);
  // The defaults are what an empty URL means, so they need no params (clean shareable URLs).
  if (sameListQuery(q, defaults)) return out;
  const body = serializeListQuery({ sort: q.sort, filters: q.filters, search: q.search, page: 1, pageSize: DEFAULT_PAGE_SIZE });
  for (const [k, v] of body.entries()) out.append(k, v);
  if (q.page !== 1) out.set("page", String(q.page));
  if (q.pageSize !== defaults.pageSize) out.set("page_size", String(q.pageSize));
  // With no list params the defaults would be re-applied on read; if the user deliberately moved
  // away from them (e.g. removed the default sort), keep an explicit marker.
  if (!hasListParams(out) && !sameListQuery(q, defaults)) out.set("page", "1");
  return out;
}
