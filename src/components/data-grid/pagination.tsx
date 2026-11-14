"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES } from "@/lib/list-query";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { pageCount, pageRange } from "./query";

export type PageSize = (typeof PAGE_SIZES)[number];

export function GridPagination({
  page,
  pageSize,
  total,
  rowsOnPage,
  onPageChange,
  onPageSizeChange,
  disabled,
  children,
}: {
  page: number;
  pageSize: number;
  total: number;
  rowsOnPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  disabled?: boolean;
  /** Extra content on the left (e.g. data attribution). */
  children?: React.ReactNode;
}) {
  const pages = pageCount(total, pageSize);
  const { from, to } = pageRange(page, pageSize, total, rowsOnPage || undefined);
  return (
    <div className="flex flex-col gap-3 px-1 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="grid gap-0.5">
        <p aria-live="polite" className="tabular">
          {total === 0 ? "No results" : from === 0 ? `${formatNumber(total)} results` : `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
        </p>
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select
            size="sm"
            className="w-[4.5rem]"
            value={String(pageSize)}
            onValueChange={(v) => {
              const size = PAGE_SIZES.find((s) => String(s) === v);
              if (size) onPageSizeChange(size);
            }}
            options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            aria-label="Rows per page"
            disabled={disabled}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="tabular">
            Page {formatNumber(Math.min(page, pages))} of {formatNumber(pages)}
          </span>
          <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page">
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= pages} aria-label="Next page">
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
