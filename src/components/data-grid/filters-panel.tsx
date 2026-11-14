"use client";
import * as React from "react";
import { Search } from "lucide-react";
import type { Facet, ListResponse } from "@/lib/api-types";
import { LEAD_STATUSES, QUALITY_STATUSES, WEBSITE_STATUSES, type VerificationStatus } from "@/lib/domain";
import type { FieldContext } from "@/lib/fields";
import type { FilterName, Filters } from "@/lib/list-query";
import { cn, formatNumber } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  filterValueLabel,
  filterValues,
  setCategoryMode,
  setFilter,
  toggleFilterValue,
  triStateOf,
  triStateValue,
  type BooleanFilterName,
  type MultiFilterName,
  type TriState,
} from "./filters";

type Facets = ListResponse["facets"];

const EMAIL_STATUS_OPTIONS: VerificationStatus[] = ["source_provided", "needs_review", "invalid", "unknown"];

function Group({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const id = React.useId();
  return (
    <fieldset className="grid gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2">
        <legend id={id} className="text-[12px] font-medium text-foreground">
          {title}
        </legend>
        {action}
      </div>
      {children}
    </fieldset>
  );
}

/** Any / Has / Missing segmented radio group (arrow keys move between options). */
function TriStateControl({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean | undefined) => void }) {
  const current = triStateOf(value);
  const options: { v: TriState; label: string }[] = [
    { v: "any", label: "Any" },
    { v: "has", label: "Has" },
    { v: "missing", label: "Missing" },
  ];
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = React.useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-muted-foreground" id={labelId}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-md bg-muted p-0.5">
        {options.map((o, i) => (
          <button
            key={o.v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={current === o.v}
            tabIndex={current === o.v ? 0 : -1}
            onClick={() => onChange(triStateValue(o.v))}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const j = (i + d + options.length) % options.length;
              onChange(triStateValue(options[j]!.v));
              refs.current[j]?.focus();
            }}
            className={cn(
              "h-6 rounded px-2 text-[12px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              current === o.v && "bg-background text-foreground shadow-xs",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Checkbox list of facet values with counts; searchable when long. */
function FacetChecklist({
  name,
  facets,
  selected,
  onToggle,
  emptyText,
}: {
  name: string;
  facets: Facet[] | undefined;
  selected: string[];
  onToggle: (v: string) => void;
  emptyText: string;
}) {
  const [q, setQ] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const baseId = React.useId();
  const known = new Set((facets ?? []).map((f) => f.value));
  const options: { value: string; count?: number }[] = [
    ...selected.filter((s) => !known.has(s)).map((value) => ({ value })),
    ...(facets ?? []),
  ];
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.value.toLowerCase().includes(needle)) : options;
  const limit = 8;
  const visible = showAll || needle ? filtered : filtered.slice(0, limit);
  if (!options.length) return <p className="text-[12px] text-muted-foreground">{emptyText}</p>;
  return (
    <div className="grid gap-1.5">
      {options.length > limit && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${name.toLowerCase()}…`} aria-label={`Find a ${name.toLowerCase()}`} className="h-7 pl-7 text-[12px]" />
        </div>
      )}
      <ul className="grid max-h-48 gap-0.5 overflow-y-auto pr-1">
        {visible.map((o, i) => {
          const id = `${baseId}-${i}`;
          const checked = selected.includes(o.value);
          return (
            <li key={o.value}>
              <label htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-muted">
                <Checkbox id={id} checked={checked} onCheckedChange={() => onToggle(o.value)} />
                <span className="min-w-0 flex-1 truncate" title={o.value}>
                  {o.value}
                </span>
                {o.count != null && (
                  <span className="tabular text-[11px] text-muted-foreground">
                    {formatNumber(o.count)}
                    <span className="sr-only"> results</span>
                  </span>
                )}
              </label>
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-1 py-1 text-[12px] text-muted-foreground">No matches</li>}
      </ul>
      {!needle && filtered.length > limit && (
        <button type="button" className="justify-self-start rounded text-[12px] text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${formatNumber(filtered.length)}`}
        </button>
      )}
    </div>
  );
}

/** Toggle pills for small enumerations (website status, quality…). */
function PillToggles<V extends string>({
  name,
  options,
  selected,
  onToggle,
  counts,
}: {
  name: MultiFilterName;
  options: readonly V[];
  selected: string[];
  onToggle: (v: V) => void;
  counts?: Facet[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => {
        const on = selected.includes(v);
        const count = counts?.find((c) => c.value === v)?.count;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(v)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              on ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {filterValueLabel(name, v)}
            {count != null && <span className={cn("tabular text-[11px]", on ? "text-primary-foreground/70" : "text-muted-foreground")}>{formatNumber(count)}</span>}
          </button>
        );
      })}
    </div>
  );
}

const fmtNum = (v: number | undefined) => (v === undefined ? "" : String(v));

/** Min/max number inputs; applied on blur or Enter, validated before applying. */
function RangeInputs({
  label,
  min,
  max,
  onChange,
  bounds,
  step,
  integer,
}: {
  label: string;
  min: number | undefined;
  max: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
  bounds: { min: number; max?: number };
  step: number;
  integer?: boolean;
}) {
  const [draftMin, setDraftMin] = React.useState(fmtNum(min));
  const [draftMax, setDraftMax] = React.useState(fmtNum(max));
  const [seen, setSeen] = React.useState({ min, max });
  if (seen.min !== min || seen.max !== max) {
    setSeen({ min, max });
    setDraftMin(fmtNum(min));
    setDraftMax(fmtNum(max));
  }
  const parse = (s: string): number | undefined | "invalid" => {
    const t = s.trim().replace(",", ".");
    if (!t) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n < bounds.min || (bounds.max !== undefined && n > bounds.max) || (integer && !Number.isInteger(n))) return "invalid";
    return n;
  };
  const pMin = parse(draftMin);
  const pMax = parse(draftMax);
  const error =
    pMin === "invalid" || pMax === "invalid"
      ? bounds.max !== undefined
        ? `Enter a number from ${bounds.min} to ${bounds.max}.`
        : `Enter a whole number of ${bounds.min} or more.`
      : pMin !== undefined && pMax !== undefined && pMin > pMax
        ? "The minimum is higher than the maximum."
        : null;
  const commit = () => {
    if (error || pMin === "invalid" || pMax === "invalid") return;
    if (pMin !== min || pMax !== max) onChange(pMin, pMax);
  };
  const id = React.useId();
  const inputProps = {
    type: "number" as const,
    inputMode: "decimal" as const,
    step,
    min: bounds.min,
    max: bounds.max,
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    },
    className: "h-8 text-[13px] tabular",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-err` : undefined,
  };
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Input {...inputProps} aria-label={`Minimum ${label.toLowerCase()}`} placeholder="Min" value={draftMin} onChange={(e) => setDraftMin(e.target.value)} />
        <span className="text-muted-foreground" aria-hidden>
          –
        </span>
        <Input {...inputProps} aria-label={`Maximum ${label.toLowerCase()}`} placeholder="Max" value={draftMax} onChange={(e) => setDraftMax(e.target.value)} />
      </div>
      {error && (
        <p id={`${id}-err`} className="text-[12px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="grid gap-0.5 text-[13px]">
        <span>{label}</span>
        {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export type FiltersPanelProps = {
  context: FieldContext;
  filters: Filters;
  onChange: (f: Filters) => void;
  facets?: Facets;
  /** Filters controlled outside the grid (e.g. tabs): their controls are hidden. */
  lockedFilters?: readonly FilterName[];
};

/** The controls inside the Filters popover. Changes apply immediately (numbers on blur/Enter). */
export function FiltersPanel({ context, filters, onChange, facets, lockedFilters = [] }: FiltersPanelProps) {
  const locked = (n: FilterName) => lockedFilters.includes(n);
  const set = <K extends FilterName>(name: K, v: Filters[K] | undefined) => onChange(setFilter(filters, name, v));
  const toggle = (name: MultiFilterName, v: string) => onChange(toggleFilterValue(filters, name, v));
  const [categoryExclude, setCategoryExclude] = React.useState(() => filterValues(filters, "exclude_category").length > 0 && filterValues(filters, "category").length === 0);
  const categoryKey: MultiFilterName = categoryExclude ? "exclude_category" : "category";
  const ids = React.useId();

  const triStates: { name: BooleanFilterName; label: string }[] = [
    { name: "has_phone", label: "Phone" },
    { name: "has_website", label: "Website" },
    { name: "has_email", label: "Email" },
    { name: "has_address", label: "Address" },
  ];
  const shownTri = triStates.filter((t) => !locked(t.name));

  return (
    <div className="grid gap-4">
      {shownTri.length > 0 && (
        <Group title="Contact details">
          <div className="grid gap-2">
            {shownTri.map((t) => (
              <TriStateControl key={t.name} label={t.label} value={filters[t.name] as boolean | undefined} onChange={(v) => set(t.name, v)} />
            ))}
          </div>
        </Group>
      )}

      {!locked("category") && !locked("exclude_category") && (
        <Group
          title="Category"
          action={
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground" htmlFor={`${ids}-excl`}>
              Exclude selected
              <Switch
                id={`${ids}-excl`}
                checked={categoryExclude}
                onCheckedChange={(v) => {
                  setCategoryExclude(v);
                  onChange(setCategoryMode(filters, v ? "exclude" : "include"));
                }}
              />
            </label>
          }
        >
          <FacetChecklist
            name="Category"
            facets={facets?.categories}
            selected={filterValues(filters, categoryKey)}
            onToggle={(v) => toggle(categoryKey, v)}
            emptyText="No categories in these results."
          />
        </Group>
      )}

      {!locked("city") && (
        <Group title="City">
          <FacetChecklist name="City" facets={facets?.cities} selected={filterValues(filters, "city")} onToggle={(v) => toggle("city", v)} emptyText="No cities in these results." />
        </Group>
      )}

      {(!locked("min_rating") || !locked("min_reviews")) && (
        <Group title="Rating and reviews">
          <div className="grid gap-2.5">
            {!locked("min_rating") && !locked("max_rating") && (
              <div className="grid gap-1">
                <span className="text-[12px] text-muted-foreground">Rating (0–5)</span>
                <RangeInputs
                  label="Rating"
                  min={filters.min_rating}
                  max={filters.max_rating}
                  bounds={{ min: 0, max: 5 }}
                  step={0.1}
                  onChange={(a, b) => onChange(setFilter(setFilter(filters, "min_rating", a), "max_rating", b))}
                />
              </div>
            )}
            {!locked("min_reviews") && !locked("max_reviews") && (
              <div className="grid gap-1">
                <span className="text-[12px] text-muted-foreground">Number of reviews</span>
                <RangeInputs
                  label="Reviews"
                  min={filters.min_reviews}
                  max={filters.max_reviews}
                  bounds={{ min: 0 }}
                  step={1}
                  integer
                  onChange={(a, b) => onChange(setFilter(setFilter(filters, "min_reviews", a), "max_reviews", b))}
                />
              </div>
            )}
          </div>
        </Group>
      )}

      {!locked("website_status") && (
        <Group title="Website status">
          <PillToggles name="website_status" options={WEBSITE_STATUSES} selected={filterValues(filters, "website_status")} onToggle={(v) => toggle("website_status", v)} counts={facets?.websiteStatus} />
        </Group>
      )}

      {!locked("email_status") && (
        <Group title="Email status">
          <PillToggles name="email_status" options={EMAIL_STATUS_OPTIONS} selected={filterValues(filters, "email_status")} onToggle={(v) => toggle("email_status", v)} />
        </Group>
      )}

      {(!locked("quality") || !locked("hide_duplicates")) && (
        <Group title="Data quality">
          {!locked("quality") && <PillToggles name="quality" options={QUALITY_STATUSES} selected={filterValues(filters, "quality")} onToggle={(v) => toggle("quality", v)} />}
          {!locked("hide_duplicates") && (
            <SwitchRow
              id={`${ids}-dupes`}
              label="Hide possible duplicates"
              hint="Rows that look like another result."
              checked={filters.hide_duplicates === true}
              onChange={(v) => set("hide_duplicates", v ? true : undefined)}
            />
          )}
        </Group>
      )}

      {context === "collection" && (
        <>
          {!locked("lead_status") && (
            <Group title="Lead status">
              <PillToggles name="lead_status" options={LEAD_STATUSES} selected={filterValues(filters, "lead_status")} onToggle={(v) => toggle("lead_status", v)} counts={facets?.leadStatus} />
            </Group>
          )}
          {(!locked("tag") || !locked("untagged")) && (
            <Group title="Tags">
              {!locked("tag") && (
                <FacetChecklist name="Tag" facets={facets?.tags} selected={filterValues(filters, "tag")} onToggle={(v) => toggle("tag", v)} emptyText="No tags yet." />
              )}
              {!locked("untagged") && (
                <SwitchRow id={`${ids}-untagged`} label="Only leads without tags" checked={filters.untagged === true} onChange={(v) => set("untagged", v ? true : undefined)} />
              )}
            </Group>
          )}
        </>
      )}
    </div>
  );
}
