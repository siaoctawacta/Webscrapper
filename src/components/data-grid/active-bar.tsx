"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { FIELDS, sortableFieldsFor, type FieldContext, type FieldKey } from "@/lib/fields";
import type { SortSpec } from "@/lib/list-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { FilterChip } from "./filters";
import { MAX_SORT_KEYS, describeSort } from "./sorting";

const chip = "inline-flex h-7 max-w-full items-center rounded-full border border-border bg-background text-[12px] text-foreground shadow-xs";
const chipBtn = "outline-none focus-visible:ring-2 focus-visible:ring-ring/40 transition-colors hover:bg-muted";

export function SortChips({
  context,
  sort,
  onFlip,
  onRemove,
  onAdd,
}: {
  context: FieldContext;
  sort: SortSpec[];
  onFlip: (f: FieldKey) => void;
  onRemove: (f: FieldKey) => void;
  onAdd: (f: FieldKey) => void;
}) {
  const available = sortableFieldsFor(context).filter((k) => !sort.some((s) => s.field === k));
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sorting">
      <span className="mr-0.5 text-[12px] text-muted-foreground">Sorted by</span>
      {sort.map((s, i) => {
        const Icon = s.direction === "asc" ? ArrowUp : ArrowDown;
        return (
          <span key={s.field} className={chip}>
            <button
              type="button"
              onClick={() => onFlip(s.field)}
              className={cn(chipBtn, "flex min-w-0 items-center gap-1 rounded-l-full py-1 pl-2.5 pr-1.5")}
              aria-label={`${describeSort(s)}. Click to reverse.`}
              title="Click to reverse"
            >
              {sort.length > 1 && <span className="tabular text-[10px] font-semibold text-muted-foreground">{i + 1}</span>}
              <span className="truncate">{FIELDS[s.field].label}</span>
              <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onRemove(s.field)}
              className={cn(chipBtn, "flex h-full items-center rounded-r-full pl-1 pr-2 text-muted-foreground hover:text-foreground")}
              aria-label={`Remove sort by ${FIELDS[s.field].label}`}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {sort.length < MAX_SORT_KEYS && available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="h-7 rounded-full text-muted-foreground">
              <Plus aria-hidden /> Add sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Then sort by</DropdownMenuLabel>
            {available.map((k) => (
              <DropdownMenuItem key={k} onSelect={() => onAdd(k)}>
                {FIELDS[k].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function FilterChips({ chips, onRemove, onClearAll }: { chips: FilterChip[]; onRemove: (c: FilterChip) => void; onClearAll: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      <span className="mr-0.5 text-[12px] text-muted-foreground">Filters</span>
      {chips.map((c) => (
        <span key={c.id} className={cn(chip, "bg-subtle pl-2.5")}>
          <span className="truncate py-1" title={c.label}>
            {c.label}
          </span>
          <button
            type="button"
            onClick={() => onRemove(c)}
            className={cn(chipBtn, "ml-1 flex h-full items-center rounded-r-full pl-1 pr-2 text-muted-foreground hover:text-foreground")}
            aria-label={`Remove filter: ${c.label}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <Button variant="link" size="xs" className="h-7 px-1 text-[12px]" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
