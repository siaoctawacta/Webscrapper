"use client";
import * as React from "react";
import { X } from "lucide-react";
import { MAX_BULK_ROWS } from "@/lib/list-query";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { exceedsBulkLimit, type GridSelection } from "./selection";

/** Banner shown above the table when the whole page (or every match) is selected. */
export function SelectionBanner({
  selection,
  pageRowCount,
  pageFullySelected,
  total,
  count,
  onSelectAll,
  onClear,
}: {
  selection: GridSelection;
  pageRowCount: number;
  pageFullySelected: boolean;
  total: number;
  count: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  if (selection.mode === "all_filtered") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg bg-accent-soft px-3 py-2 text-center text-[13px] text-accent-soft-foreground" role="status">
        <span>
          {selection.excludedIds.length === 0
            ? `All ${formatNumber(total)} matching results are selected.`
            : `${formatNumber(count)} of ${formatNumber(total)} matching results are selected.`}
          {exceedsBulkLimit(count) && ` Actions apply to at most ${formatNumber(MAX_BULK_ROWS)} rows.`}
        </span>
        <Button variant="link" size="xs" className="h-auto text-[13px] text-accent-soft-foreground underline" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    );
  }
  if (!pageFullySelected || total <= pageRowCount) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg bg-accent-soft px-3 py-2 text-center text-[13px] text-accent-soft-foreground" role="status">
      <span>All {formatNumber(pageRowCount)} on this page are selected.</span>
      <Button variant="link" size="xs" className="h-auto text-[13px] font-semibold text-accent-soft-foreground underline" onClick={onSelectAll}>
        Select all {formatNumber(total)} matching results
      </Button>
    </div>
  );
}

/** Sticky bar with the selection count and the page's bulk actions. */
export function SelectionBar({ count, children, onClear }: { count: number; children?: React.ReactNode; onClear: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none sticky bottom-3 z-30 flex justify-center px-1">
      <div
        role="region"
        aria-label="Selection actions"
        className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-xl border border-border bg-popover py-1.5 pl-3.5 pr-1.5 text-[13px] shadow-lg animate-in"
      >
        <span className="shrink-0 font-medium tabular">{formatNumber(count)} selected</span>
        {children && <span className="h-5 w-px shrink-0 bg-border" aria-hidden />}
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection" className="shrink-0">
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}
