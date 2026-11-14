/**
 * List query contract shared by the results grid and collections grid:
 *   ?page=1&page_size=50&sort=category:asc&sort=business_name:asc
 *   &filter[has_phone]=true&filter[category]=Hotel&filter[category]=Lodging&search=salon
 *
 * Everything is validated against explicit allowlists. Unknown sort fields or filters are
 * rejected (never passed through to SQL). Isomorphic.
 */
import { z } from "zod";
import { FIELDS, isFieldKey, type FieldContext, type FieldKey } from "./fields";
import {
  LEAD_STATUSES,
  QUALITY_STATUSES,
  VERIFICATION_STATUSES,
  WEBSITE_STATUSES,
  SOURCE_IDS,
} from "./domain";

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_SORT_KEYS = 3;
/** Upper bound for "select all filtered rows" and filtered exports. */
export const MAX_BULK_ROWS = 20000;

export type SortDirection = "asc" | "desc";
export type SortSpec = { field: FieldKey; direction: SortDirection };

const bool = z.boolean();
const str = z.string().trim().min(1).max(200);
const strList = z.array(str).max(50);
const nonNeg = z.number().finite().min(0);

/** Filter allowlist: name → value schema + which grids accept it. */
export const FILTER_DEFS = {
  has_phone: { schema: bool, kind: "boolean", contexts: ["results", "collection"] },
  has_website: { schema: bool, kind: "boolean", contexts: ["results", "collection"] },
  has_email: { schema: bool, kind: "boolean", contexts: ["results", "collection"] },
  has_address: { schema: bool, kind: "boolean", contexts: ["results", "collection"] },
  category: { schema: strList, kind: "multi", contexts: ["results", "collection"] },
  exclude_category: { schema: strList, kind: "multi", contexts: ["results", "collection"] },
  city: { schema: strList, kind: "multi", contexts: ["results", "collection"] },
  country: { schema: strList, kind: "multi", contexts: ["results", "collection"] },
  min_rating: { schema: z.number().min(0).max(5), kind: "number", contexts: ["results", "collection"] },
  max_rating: { schema: z.number().min(0).max(5), kind: "number", contexts: ["results", "collection"] },
  min_reviews: { schema: nonNeg, kind: "number", contexts: ["results", "collection"] },
  max_reviews: { schema: nonNeg, kind: "number", contexts: ["results", "collection"] },
  quality: { schema: z.array(z.enum(QUALITY_STATUSES)).max(10), kind: "multi", contexts: ["results", "collection"] },
  website_status: { schema: z.array(z.enum(WEBSITE_STATUSES)).max(10), kind: "multi", contexts: ["results", "collection"] },
  email_status: { schema: z.array(z.enum(VERIFICATION_STATUSES)).max(10), kind: "multi", contexts: ["results", "collection"] },
  source: { schema: z.array(z.enum(SOURCE_IDS)).max(5), kind: "multi", contexts: ["results", "collection"] },
  name_contains: { schema: str, kind: "text", contexts: ["results", "collection"] },
  name_starts_with: { schema: str, kind: "text", contexts: ["results", "collection"] },
  domain_contains: { schema: str, kind: "text", contexts: ["results", "collection"] },
  address_contains: { schema: str, kind: "text", contexts: ["results", "collection"] },
  hide_duplicates: { schema: bool, kind: "boolean", contexts: ["results", "collection"] },
  lead_status: { schema: z.array(z.enum(LEAD_STATUSES)).max(10), kind: "multi", contexts: ["collection"] },
  tag: { schema: strList, kind: "multi", contexts: ["collection"] },
  untagged: { schema: bool, kind: "boolean", contexts: ["collection"] },
} as const satisfies Record<string, { schema: z.ZodType; kind: string; contexts: readonly FieldContext[] }>;

export type FilterName = keyof typeof FILTER_DEFS;
export type Filters = { [K in FilterName]?: z.infer<(typeof FILTER_DEFS)[K]["schema"]> };

export type ListQuery = {
  page: number;
  pageSize: number;
  sort: SortSpec[];
  filters: Filters;
  search?: string;
};

export const defaultListQuery = (): ListQuery => ({ page: 1, pageSize: DEFAULT_PAGE_SIZE, sort: [], filters: {} });

export class ListQueryError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
    this.name = "ListQueryError";
  }
}

const isFilterName = (k: string): k is FilterName => Object.prototype.hasOwnProperty.call(FILTER_DEFS, k);

function coerceFilterValue(name: FilterName, raw: string[]): unknown {
  const def = FILTER_DEFS[name];
  switch (def.kind) {
    case "boolean": {
      const v = raw[raw.length - 1];
      if (v === "true" || v === "1") return true;
      if (v === "false" || v === "0") return false;
      return v; // fails validation below
    }
    case "number":
      return Number(raw[raw.length - 1]);
    case "text":
      return raw[raw.length - 1];
    case "multi":
      return raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  }
}

/** Validate an already-structured filters object (e.g. from a JSON body). */
export function validateFilters(input: unknown, ctx: FieldContext): Filters {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ListQueryError(["filters must be an object"]);
  const out: Record<string, unknown> = {};
  const issues: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (!isFilterName(k)) {
      issues.push(`Unknown filter "${k}"`);
      continue;
    }
    const def = FILTER_DEFS[k];
    if (!(def.contexts as readonly string[]).includes(ctx)) {
      issues.push(`Filter "${k}" is not available here`);
      continue;
    }
    const parsed = def.schema.safeParse(v);
    if (!parsed.success) issues.push(`Invalid value for filter "${k}"`);
    else if (!(Array.isArray(parsed.data) && parsed.data.length === 0)) out[k] = parsed.data;
  }
  if (issues.length) throw new ListQueryError(issues);
  return out as Filters;
}

export function validateSort(input: unknown, ctx: FieldContext): SortSpec[] {
  if (input == null) return [];
  const arr = Array.isArray(input) ? input : [input];
  const issues: string[] = [];
  const out: SortSpec[] = [];
  for (const item of arr) {
    let field: string | undefined;
    let direction: string | undefined;
    if (typeof item === "string") [field, direction = "asc"] = item.split(":");
    else if (item && typeof item === "object") ({ field, direction = "asc" } = item as { field?: string; direction?: string });
    if (!field || !isFieldKey(field) || !FIELDS[field].sortable || !FIELDS[field].contexts.includes(ctx)) {
      issues.push(`Cannot sort by "${String(field)}"`);
      continue;
    }
    if (direction !== "asc" && direction !== "desc") {
      issues.push(`Sort direction must be asc or desc`);
      continue;
    }
    if (out.some((s) => s.field === field)) continue;
    out.push({ field, direction });
  }
  if (out.length > MAX_SORT_KEYS) issues.push(`At most ${MAX_SORT_KEYS} sort keys`);
  if (issues.length) throw new ListQueryError(issues);
  return out;
}

/** Parse `URLSearchParams` into a validated ListQuery. Throws ListQueryError (→ HTTP 422). */
export function parseListQuery(params: URLSearchParams, ctx: FieldContext): ListQuery {
  const issues: string[] = [];
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("page_size") ?? DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || page > 100000) issues.push("page must be a positive integer");
  if (!(PAGE_SIZES as readonly number[]).includes(pageSize)) issues.push(`page_size must be one of ${PAGE_SIZES.join(", ")}`);

  const rawFilters = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const m = /^filter\[([a-z_]+)\]$/.exec(key);
    if (m) rawFilters.set(m[1]!, [...(rawFilters.get(m[1]!) ?? []), value]);
    else if (key.startsWith("filter")) issues.push(`Malformed filter parameter "${key}"`);
  }
  const structured: Record<string, unknown> = {};
  for (const [name, values] of rawFilters) {
    structured[name] = isFilterName(name) ? coerceFilterValue(name, values) : values;
  }

  let filters: Filters = {};
  let sort: SortSpec[] = [];
  try {
    filters = validateFilters(structured, ctx);
  } catch (e) {
    if (e instanceof ListQueryError) issues.push(...e.issues);
    else throw e;
  }
  try {
    sort = validateSort(params.getAll("sort"), ctx);
  } catch (e) {
    if (e instanceof ListQueryError) issues.push(...e.issues);
    else throw e;
  }
  const search = params.get("search")?.trim().slice(0, 200) || undefined;
  if (issues.length) throw new ListQueryError(issues);
  return { page, pageSize, sort, filters, search };
}

/** Validate a ListQuery that arrived as JSON (e.g. export or bulk-action bodies). */
export function validateListQuery(input: unknown, ctx: FieldContext): ListQuery {
  const o = (input ?? {}) as Partial<ListQuery>;
  const page = o.page ?? 1;
  const pageSize = o.pageSize ?? DEFAULT_PAGE_SIZE;
  const issues: string[] = [];
  if (!Number.isInteger(page) || page < 1) issues.push("page must be a positive integer");
  if (!(PAGE_SIZES as readonly number[]).includes(pageSize)) issues.push(`pageSize must be one of ${PAGE_SIZES.join(", ")}`);
  if (issues.length) throw new ListQueryError(issues);
  return {
    page,
    pageSize,
    sort: validateSort(o.sort ?? [], ctx),
    filters: validateFilters(o.filters ?? {}, ctx),
    search: typeof o.search === "string" ? o.search.trim().slice(0, 200) || undefined : undefined,
  };
}

/** Serialize a ListQuery to query-string form (used by the UI). */
export function serializeListQuery(q: Partial<ListQuery>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.page && q.page !== 1) p.set("page", String(q.page));
  if (q.pageSize && q.pageSize !== DEFAULT_PAGE_SIZE) p.set("page_size", String(q.pageSize));
  for (const s of q.sort ?? []) p.append("sort", `${s.field}:${s.direction}`);
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(`filter[${k}]`, String(x)));
    else p.set(`filter[${k}]`, String(v));
  }
  if (q.search) p.set("search", q.search);
  return p;
}
