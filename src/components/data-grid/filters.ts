/**
 * Filter helpers for the grid (pure): typed updates, active-filter chips and their removal.
 * Works for every filter in FILTER_DEFS, so filters that arrive via the URL can always be shown
 * and removed even if the Filters panel has no control for them.
 */
import { LEAD_STATUS_LABELS, type LeadStatus, type QualityStatus, type SourceId, type VerificationStatus, type WebsiteStatus } from "@/lib/domain";
import { FILTER_DEFS, type FilterName, type Filters } from "@/lib/list-query";
import { formatNumber } from "@/lib/utils";
import { QUALITY_LABELS, SOURCE_LABELS, VERIFICATION_LABELS, WEBSITE_STATUS_LABELS } from "@/components/business/labels";

type FilterKind = (typeof FILTER_DEFS)[FilterName]["kind"];
type NamesOfKind<T extends FilterKind> = { [K in FilterName]: (typeof FILTER_DEFS)[K]["kind"] extends T ? K : never }[FilterName];

export type BooleanFilterName = NamesOfKind<"boolean">;
export type MultiFilterName = NamesOfKind<"multi">;
export type NumberFilterName = NamesOfKind<"number">;
export type TextFilterName = NamesOfKind<"text">;

export const FILTER_NAMES = Object.keys(FILTER_DEFS) as FilterName[];

const isBlank = (v: unknown) =>
  v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && v.trim() === "");

/** Set (or with `undefined`/empty, remove) one filter. Returns a new object. */
export function setFilter<K extends FilterName>(filters: Filters, name: K, value: Filters[K] | undefined): Filters {
  const next: Filters = { ...filters };
  if (isBlank(value)) delete next[name];
  else next[name] = value;
  return next;
}

/** Add or remove one value of a multi-value filter. */
export function toggleFilterValue(filters: Filters, name: MultiFilterName, value: string): Filters {
  const current = (filters[name] as readonly string[] | undefined) ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return setFilter(filters, name, next as Filters[typeof name]);
}

export const filterValues = (filters: Filters, name: MultiFilterName): string[] => [...((filters[name] as readonly string[] | undefined) ?? [])];

/** Tri-state for "has X" filters: undefined = any, true = has, false = missing. */
export type TriState = "any" | "has" | "missing";
export const triStateOf = (v: boolean | undefined): TriState => (v === true ? "has" : v === false ? "missing" : "any");
export const triStateValue = (t: TriState): boolean | undefined => (t === "has" ? true : t === "missing" ? false : undefined);

/** Keep only `keep` filters (e.g. ones controlled by page tabs). */
export function clearFilters(filters: Filters, keep: readonly FilterName[] = []): Filters {
  const next: Filters = {};
  for (const k of keep) {
    if (filters[k] !== undefined) (next as Record<string, unknown>)[k] = filters[k];
  }
  return next;
}

/** Move the selected categories between include and exclude mode. */
export function setCategoryMode(filters: Filters, mode: "include" | "exclude"): Filters {
  const from = mode === "exclude" ? "category" : "exclude_category";
  const to = mode === "exclude" ? "exclude_category" : "category";
  const moving = filterValues(filters, from);
  if (!moving.length) return filters;
  const merged = [...new Set([...filterValues(filters, to), ...moving])];
  return setFilter(setFilter(filters, from, undefined), to, merged);
}

// ---------- chips ----------

export type FilterChip = {
  /** Stable key: `name` or `name:value`. */
  id: string;
  filter: FilterName;
  /** The value this chip represents for multi-value filters. */
  value?: string;
  label: string;
};

const BOOL_LABELS: Partial<Record<BooleanFilterName, { yes: string; no?: string }>> = {
  has_phone: { yes: "Has phone", no: "No phone" },
  has_website: { yes: "Has website", no: "No website" },
  has_email: { yes: "Has email", no: "No email" },
  has_address: { yes: "Has address", no: "No address" },
  hide_duplicates: { yes: "Duplicates hidden" },
  untagged: { yes: "Untagged only" },
};

const MULTI_PREFIX: Record<MultiFilterName, string> = {
  category: "Category",
  exclude_category: "Excluding",
  city: "City",
  country: "Country",
  quality: "Quality",
  website_status: "Website",
  email_status: "Email",
  source: "Source",
  lead_status: "Status",
  tag: "Tag",
};

const TEXT_LABELS: Record<TextFilterName, string> = {
  name_contains: "Name contains",
  name_starts_with: "Name starts with",
  domain_contains: "Website contains",
  address_contains: "Address contains",
};

/** Display label for one value of a multi-value filter. */
export function filterValueLabel(name: MultiFilterName, value: string): string {
  switch (name) {
    case "quality":
      return QUALITY_LABELS[value as QualityStatus] ?? value;
    case "website_status":
      return WEBSITE_STATUS_LABELS[value as WebsiteStatus] ?? value;
    case "email_status":
      return VERIFICATION_LABELS[value as VerificationStatus] ?? value;
    case "source":
      return SOURCE_LABELS[value as SourceId] ?? value;
    case "lead_status":
      return LEAD_STATUS_LABELS[value as LeadStatus] ?? value;
    default:
      return value;
  }
}

function numberChipLabel(name: NumberFilterName, v: number): string {
  switch (name) {
    case "min_rating":
      return `Rating ≥ ${v}`;
    case "max_rating":
      return `Rating ≤ ${v}`;
    case "min_reviews":
      return `${formatNumber(v)}+ reviews`;
    case "max_reviews":
      return `≤ ${formatNumber(v)} reviews`;
  }
}

/**
 * One chip per active filter value, in FILTER_DEFS order. Filters listed in `exclude` (e.g. those
 * controlled by page tabs) produce no chips.
 */
export function deriveFilterChips(filters: Filters, opts: { exclude?: readonly FilterName[] } = {}): FilterChip[] {
  const chips: FilterChip[] = [];
  const skip = new Set(opts.exclude ?? []);
  for (const name of FILTER_NAMES) {
    if (skip.has(name)) continue;
    const value = filters[name];
    if (isBlank(value)) continue;
    const kind = FILTER_DEFS[name].kind;
    if (kind === "boolean") {
      const labels = BOOL_LABELS[name as BooleanFilterName];
      const label = value === true ? labels?.yes : labels?.no;
      if (label) chips.push({ id: name, filter: name, label });
    } else if (kind === "multi") {
      for (const v of value as readonly string[]) {
        const m = name as MultiFilterName;
        chips.push({ id: `${name}:${v}`, filter: name, value: v, label: `${MULTI_PREFIX[m]}: ${filterValueLabel(m, v)}` });
      }
    } else if (kind === "number") {
      chips.push({ id: name, filter: name, label: numberChipLabel(name as NumberFilterName, value as number) });
    } else if (kind === "text") {
      chips.push({ id: name, filter: name, label: `${TEXT_LABELS[name as TextFilterName]} “${String(value)}”` });
    }
  }
  return chips;
}

/** Remove what a chip represents (one value of a multi filter, or the whole filter). */
export function removeFilterChip(filters: Filters, chip: Pick<FilterChip, "filter" | "value">): Filters {
  const kind = FILTER_DEFS[chip.filter].kind;
  if (kind === "multi" && chip.value !== undefined) {
    const name = chip.filter as MultiFilterName;
    return setFilter(filters, name, filterValues(filters, name).filter((v) => v !== chip.value) as Filters[typeof name]);
  }
  return setFilter(filters, chip.filter, undefined);
}

export const countActiveFilters = (filters: Filters, opts: { exclude?: readonly FilterName[] } = {}) =>
  deriveFilterChips(filters, opts).length;
