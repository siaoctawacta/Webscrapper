"use client";
import * as React from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert, Columns3, ListFilter, SearchX } from "lucide-react";
import type { BusinessRow, ListResponse, SourcePolicyInfo } from "@/lib/api-types";
import { FIELDS, type FieldContext, type FieldKey } from "@/lib/fields";
import type { FilterName, ListQuery } from "@/lib/list-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, Progress, Skeleton } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLUMN_WIDTHS, NUMERIC_COLUMNS, renderBusinessCell, type CellRenderContext } from "@/components/business/cells";
import { attributionFor, fieldValue } from "@/components/business/row-utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { FilterChips, SortChips } from "./active-bar";
import { normalizeColumns, resetColumns as defaultColumnLayout } from "./columns";
import { ColumnsPanel } from "./columns-panel";
import { clearFilters, deriveFilterChips, removeFilterChip } from "./filters";
import { FiltersPanel } from "./filters-panel";
import { GridPagination, type PageSize } from "./pagination";
import { applyQueryPatch, matchSignature, pageCount } from "./query";
import { QuickSearch } from "./quick-search";
import { SelectionBanner, SelectionBar } from "./selection-bar";
import {
  emptySelection,
  isSelected,
  pageSelectionState,
  selectAllFiltered,
  selectionCount,
  setSelected,
  toggle,
  type GridSelection,
} from "./selection";
import { MAX_SORT_KEYS, addSort, describeSort, flipSort, removeSort, sortStateOf, toggleSort } from "./sorting";

export type DataGridProps = {
  /** Which grid this is: decides available columns and filters. */
  context: FieldContext;
  /** Rows of the current page, as returned by the server. */
  rows: BusinessRow[];
  /** Total rows matching the query (all pages). */
  total: number;
  /** First load (no rows yet): shows skeleton rows. */
  isLoading?: boolean;
  /** Background refetch: shows a thin progress bar and dims the rows. */
  isFetching?: boolean;
  /** Error message to show instead of rows. */
  error?: string | null;
  onRetry?: () => void;
  /** Current list query (page, sort, filters, search) — usually from useListQueryState. */
  query: ListQuery;
  /** Called with the next query. Sort/filter/search/page-size changes already reset page to 1. */
  onQueryChange: (q: ListQuery) => void;
  /** Called when the user picks a page size (in addition to onQueryChange) — e.g. to save it. */
  onPageSizeChange?: (size: PageSize) => void;
  /** Visible columns in order (business_name is always shown first). */
  columns: FieldKey[];
  onColumnsChange: (cols: FieldKey[]) => void;
  /** "Reset to default" in the column chooser; defaults to onColumnsChange(defaultColumns). */
  onResetColumns?: () => void;
  selection: GridSelection;
  onSelectionChange: (s: GridSelection) => void;
  /** Keep the selection when filters/search change (default: cleared, so bulk actions never hit hidden rows). */
  preserveSelectionOnFilterChange?: boolean;
  facets?: ListResponse["facets"];
  policies?: SourcePolicyInfo[];
  /** Open a row's details (row click, Enter/Space on a focused row, or the business name). */
  onRowOpen?: (row: BusinessRow) => void;
  /** Highlights the row whose details are open. */
  activeRowId?: string | null;
  /** Content of the trailing sticky actions cell (e.g. <RowActionsMenu>). */
  rowActions?: (row: BusinessRow) => React.ReactNode;
  /** Replace a field's cell content (e.g. inline editors for lead_status / tags). */
  renderCellOverride?: Partial<Record<FieldKey, (row: BusinessRow) => React.ReactNode>>;
  /** Shown when there are no rows and no filters/search are active. */
  emptyState?: React.ReactNode;
  toolbarStart?: React.ReactNode;
  toolbarEnd?: React.ReactNode;
  /** Bulk actions for the selection bar. */
  selectionActions?: (selection: GridSelection, count: number) => React.ReactNode;
  /** Filters controlled outside the grid (e.g. segment tabs): no chips or controls, kept by "Clear all". */
  lockedFilters?: FilterName[];
  /** The job is still visiting websites: unknown website statuses read "Checking…". */
  enrichmentInProgress?: boolean;
  searchPlaceholder?: string;
  /** Max height of the scroll area (sticky header scrolls inside). Default: calc(100dvh - 12rem). */
  maxHeight?: string;
  "aria-label"?: string;
  className?: string;
};

const SELECT_W = 44;
const ACTIONS_W = 52;
const MOBILE_NAME_W = 172;

const ROW_BG =
  "[--row-bg:var(--color-background)] hover:[--row-bg:color-mix(in_oklab,var(--color-muted)_45%,var(--color-background))] data-[selected=true]:[--row-bg:color-mix(in_oklab,var(--color-accent-soft)_45%,var(--color-background))] data-[selected=true]:hover:[--row-bg:color-mix(in_oklab,var(--color-accent-soft)_70%,var(--color-background))] data-[active=true]:[--row-bg:color-mix(in_oklab,var(--color-muted)_80%,var(--color-background))]";

const INTERACTIVE = "a,button,input,textarea,select,label,[role=checkbox],[role=menuitem],[role=combobox],[data-grid-ignore]";

type ColKind = "select" | "field" | "actions";
const kindOf = (id: string): ColKind => (id === "__select" ? "select" : id === "__actions" ? "actions" : "field");

/**
 * Server-driven business grid. See ./index.ts for a usage example.
 */
export function DataGrid(props: DataGridProps) {
  const {
    context,
    rows,
    total,
    isLoading,
    isFetching,
    error,
    onRetry,
    query,
    onQueryChange,
    onPageSizeChange,
    columns: columnsProp,
    onColumnsChange,
    onResetColumns,
    selection,
    onSelectionChange,
    preserveSelectionOnFilterChange,
    facets,
    policies,
    onRowOpen,
    activeRowId,
    rowActions,
    renderCellOverride,
    emptyState,
    toolbarStart,
    toolbarEnd,
    selectionActions,
    lockedFilters,
    enrichmentInProgress,
    searchPlaceholder,
    maxHeight = "calc(100dvh - 12rem)",
    className,
  } = props;

  const isMobile = useMediaQuery("(max-width: 640px)");
  const columns = React.useMemo(() => normalizeColumns(columnsProp, context), [columnsProp, context]);
  const locked = React.useMemo(() => lockedFilters ?? [], [lockedFilters]);
  const hasActions = !!rowActions;

  const patch = React.useCallback((p: Partial<ListQuery>) => onQueryChange(applyQueryPatch(query, p)), [onQueryChange, query]);

  // ----- selection housekeeping -----
  const signature = matchSignature(query);
  const prevSignature = React.useRef(signature);
  const count = selectionCount(selection, total);
  React.useEffect(() => {
    if (prevSignature.current === signature) return;
    prevSignature.current = signature;
    if (!preserveSelectionOnFilterChange && count > 0) onSelectionChange(emptySelection());
  }, [signature, preserveSelectionOnFilterChange, count, onSelectionChange]);

  const pageIds = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const pageState = pageSelectionState(selection, pageIds);
  const lastClicked = React.useRef<number | null>(null);

  // ----- table model (TanStack Table in manual mode: the server sorts, filters and paginates) -----
  const sorting = React.useMemo<SortingState>(() => query.sort.map((s) => ({ id: s.field, desc: s.direction === "desc" })), [query.sort]);
  const columnDefs = React.useMemo<ColumnDef<BusinessRow>[]>(() => {
    const defs: ColumnDef<BusinessRow>[] = [{ id: "__select", size: SELECT_W, enableSorting: false }];
    for (const key of columns) {
      defs.push({
        id: key,
        // An accessor is required for TanStack to treat the column as sortable (sorting itself is server-side).
        accessorFn: (r) => fieldValue(r, key),
        size: key === "business_name" && isMobile ? MOBILE_NAME_W : COLUMN_WIDTHS[key],
        enableSorting: FIELDS[key].sortable,
        header: FIELDS[key].label,
      });
    }
    if (hasActions) defs.push({ id: "__actions", size: ACTIONS_W, enableSorting: false });
    return defs;
  }, [columns, hasActions, isMobile]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns a mutable instance; this component is not compiled with React Compiler.
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    enableMultiSort: true,
    maxMultiSortColCount: MAX_SORT_KEYS,
    rowCount: total,
    state: { sorting, pagination: { pageIndex: query.page - 1, pageSize: query.pageSize } },
  });

  const totalWidth = columnDefs.reduce((acc, c) => acc + (c.size ?? 150), 0);
  const nameLeft = SELECT_W;

  // ----- cell context -----
  const cellCtx = React.useMemo<CellRenderContext>(() => ({ context, policies, enrichmentInProgress, onOpen: onRowOpen }), [context, policies, enrichmentInProgress, onRowOpen]);

  // ----- scroll to top when the page of rows changes -----
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const pageKey = `${query.page}|${query.pageSize}|${signature}|${JSON.stringify(query.sort)}`;
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pageKey]);

  // ----- keyboard navigation (roving tabindex over rows) -----
  const [focusIndex, setFocusIndex] = React.useState(0);
  const fi = Math.min(focusIndex, Math.max(0, rows.length - 1));
  const focusRow = (i: number) => {
    const el = tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${i}"]`);
    if (el) {
      setFocusIndex(i);
      el.focus();
    }
  };
  // When a refetch replaces the rows under a focused row, its <tr> unmounts and focus would drop to
  // <body>; keep keyboard users in the grid at the same position instead.
  const rowHadFocus = React.useRef(false);
  const rowsKey = pageIds.join(",");
  React.useEffect(() => {
    if (!rowHadFocus.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const i = Math.min(focusIndex, pageIds.length - 1);
    if (i >= 0) tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${i}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the set of rows changes
  }, [rowsKey]);

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, i: number, row: BusinessRow) => {
    if (e.target !== e.currentTarget) return; // keys typed inside cell controls (or portaled editors) are theirs
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(Math.min(rows.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "Enter":
      case " ":
        if (onRowOpen) {
          e.preventDefault();
          onRowOpen(row);
        }
        break;
      case "x":
      case "X":
        if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onSelectionChange(toggle(selection, row.id));
        }
        break;
    }
  };

  const onRowClick = (e: React.MouseEvent<HTMLTableRowElement>, row: BusinessRow) => {
    if (!onRowOpen) return;
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return; // clicks inside portaled popovers
    if (target.closest(INTERACTIVE)) return;
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return; // user is selecting text
    onRowOpen(row);
  };

  const onCheckboxClick = (e: React.MouseEvent, i: number, row: BusinessRow) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !isSelected(selection, row.id);
    if (e.shiftKey && lastClicked.current != null && lastClicked.current !== i) {
      const [a, b] = [Math.min(lastClicked.current, i), Math.max(lastClicked.current, i)];
      onSelectionChange(setSelected(selection, pageIds.slice(a, b + 1), next));
    } else {
      onSelectionChange(setSelected(selection, [row.id], next));
    }
    lastClicked.current = i;
  };

  const onSortClick = (key: FieldKey, e: React.MouseEvent) => {
    const r = toggleSort(query.sort, key, { additive: e.shiftKey });
    if (r.limited) {
      toast.info(`You can sort by up to ${MAX_SORT_KEYS} columns. Remove one first.`);
      return;
    }
    patch({ sort: r.sort });
  };

  // ----- chips -----
  const chips = deriveFilterChips(query.filters, { exclude: locked });
  const activeCount = chips.length;
  const constrained = activeCount > 0 || !!query.search;
  const clearAllFilters = () => patch({ filters: clearFilters(query.filters, locked) });

  // ----- attribution for the sources on screen -----
  const attributions = [...new Set(rows.map((r) => r.source))]
    .map((s) => attributionFor(s, policies))
    .filter((a): a is string => !!a);

  const pages = pageCount(total, query.pageSize);
  const showSkeleton = !!isLoading && rows.length === 0 && !error;
  const showEmpty = !isLoading && !error && rows.length === 0;
  const visibleCols = table.getVisibleLeafColumns();

  return (
    <div className={cn("grid min-w-0 gap-3", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {toolbarStart}
        <QuickSearch value={query.search} onChange={(search) => patch({ search })} placeholder={searchPlaceholder} className="w-full sm:w-72" />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" aria-label={activeCount ? `Filters, ${activeCount} active` : "Filters"}>
              <ListFilter aria-hidden />
              Filters
              {activeCount > 0 && <span className="tabular rounded-full bg-primary px-1.5 text-[11px] leading-4 text-primary-foreground">{activeCount}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex max-h-[min(80dvh,var(--radix-popover-content-available-height))] w-[calc(100vw-2rem)] flex-col p-0 sm:w-[23rem]">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <p className="text-[13px] font-medium">Filters</p>
              <Button variant="link" size="xs" className="text-[12px]" onClick={clearAllFilters} disabled={activeCount === 0}>
                Clear all
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <FiltersPanel context={context} filters={query.filters} onChange={(filters) => patch({ filters })} facets={facets} lockedFilters={locked} />
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Columns3 aria-hidden />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[calc(100vw-2rem)] p-3 sm:w-80">
            <ColumnsPanel
              context={context}
              columns={columns}
              onChange={onColumnsChange}
              onReset={onResetColumns ?? (() => onColumnsChange(defaultColumnLayout(context)))}
            />
          </PopoverContent>
        </Popover>
        {toolbarEnd && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbarEnd}</div>}
      </div>

      {/* Active sorts and filters */}
      {(query.sort.length > 0 || chips.length > 0) && (
        <div className="grid gap-2">
          {query.sort.length > 0 && (
            <SortChips
              context={context}
              sort={query.sort}
              onFlip={(f) => patch({ sort: flipSort(query.sort, f) })}
              onRemove={(f) => patch({ sort: removeSort(query.sort, f) })}
              onAdd={(f) => patch({ sort: addSort(query.sort, f) })}
            />
          )}
          {chips.length > 0 && <FilterChips chips={chips} onRemove={(c) => patch({ filters: removeFilterChip(query.filters, c) })} onClearAll={clearAllFilters} />}
        </div>
      )}

      <SelectionBanner
        selection={selection}
        pageRowCount={rows.length}
        pageFullySelected={pageState === true}
        total={total}
        count={count}
        onSelectAll={() => onSelectionChange(selectAllFiltered())}
        onClear={() => onSelectionChange(emptySelection())}
      />

      {/* Table */}
      <div className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-background">
        {isFetching && !showSkeleton && (
          <div className="absolute inset-x-0 top-0 z-40">
            <Progress value={0} indeterminate className="h-0.5 rounded-none bg-transparent" />
          </div>
        )}
        <div ref={scrollRef} className="overflow-auto overscroll-x-contain" style={{ maxHeight }}>
          <table
            className="table-fixed border-separate border-spacing-0 text-[13px]"
            style={{ width: totalWidth, minWidth: "100%" }}
            aria-label={props["aria-label"] ?? "Businesses"}
            aria-rowcount={total + 1}
            aria-busy={isFetching || isLoading ? true : undefined}
          >
            <colgroup>
              {visibleCols.map((c) => (
                <col key={c.id} style={{ width: c.getSize() }} />
              ))}
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const kind = kindOf(h.column.id);
                    const base = "sticky top-0 h-10 border-b border-border bg-subtle px-3 text-left align-middle text-[12px] font-medium text-muted-foreground";
                    if (kind === "select") {
                      return (
                        <th key={h.id} scope="col" className={cn(base, "left-0 z-30 px-0")}>
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={pageState}
                              disabled={rows.length === 0}
                              onCheckedChange={(v) => onSelectionChange(setSelected(selection, pageIds, v === true))}
                              aria-label="Select all rows on this page"
                            />
                          </div>
                        </th>
                      );
                    }
                    if (kind === "actions") {
                      return (
                        <th key={h.id} scope="col" className={cn(base, "right-0 z-30 shadow-[inset_1px_0_0_var(--color-border)]")}>
                          <span className="sr-only">Actions</span>
                        </th>
                      );
                    }
                    const key = h.column.id as FieldKey;
                    const sortState = sortStateOf(query.sort, key);
                    const sortable = h.column.getCanSort();
                    const numeric = NUMERIC_COLUMNS.has(key);
                    const isName = key === "business_name";
                    const Icon = sortState ? (sortState.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                    const label = flexRender(h.column.columnDef.header, h.getContext());
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        aria-sort={sortState ? (sortState.direction === "asc" ? "ascending" : "descending") : undefined}
                        className={cn(base, isName ? "z-30 shadow-[inset_-1px_0_0_var(--color-border)]" : "z-20", numeric && "text-right")}
                        style={isName ? { left: nameLeft } : undefined}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={(e) => onSortClick(key, e)}
                            title={`${FIELDS[key].help ? `${FIELDS[key].help} ` : ""}Click to sort; Shift+click to add a secondary sort.`}
                            aria-label={`${FIELDS[key].label}${sortState ? `, sorted ${describeSort({ field: key, direction: sortState.direction }).split(", ")[1]}` : ""}. Sort`}
                            className={cn(
                              "group/sort -mx-1.5 inline-flex max-w-[calc(100%+0.75rem)] items-center gap-1 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                              sortState && "text-foreground",
                              numeric && "flex-row-reverse",
                            )}
                          >
                            <span className="truncate">{label}</span>
                            <Icon className={cn("size-3 shrink-0", !sortState && "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")} aria-hidden />
                            {sortState && query.sort.length > 1 && <span className="tabular text-[10px] font-semibold text-muted-foreground">{sortState.priority}</span>}
                          </button>
                        ) : (
                          <span className="block truncate" title={FIELDS[key].help}>
                            {label}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody ref={tbodyRef} className={cn("transition-opacity", isFetching && !showSkeleton && "opacity-60")}>
              {showSkeleton &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={`sk-${i}`} aria-hidden>
                    {visibleCols.map((c, j) => (
                      <td key={c.id} className={cn("h-11 border-b border-border px-3", j === 0 && "px-0")}>
                        {j === 0 ? <Skeleton className="mx-auto size-4 rounded" /> : <Skeleton className="h-3.5" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} />}
                      </td>
                    ))}
                  </tr>
                ))}
              {!showSkeleton &&
                table.getRowModel().rows.map((tr, i) => {
                  const row = tr.original;
                  const selected = isSelected(selection, row.id);
                  return (
                    <tr
                      key={tr.id}
                      data-row-index={i}
                      data-selected={selected}
                      data-active={activeRowId === row.id}
                      tabIndex={i === fi ? 0 : -1}
                      aria-rowindex={(query.page - 1) * query.pageSize + i + 2}
                      aria-label={row.name ?? "Business"}
                      onFocus={(e) => {
                        if (e.target === e.currentTarget) {
                          rowHadFocus.current = true;
                          setFocusIndex(i);
                        }
                      }}
                      onBlur={(e) => {
                        // Moving to another row or a control inside the grid keeps "row focus"; leaving the table clears it.
                        if (!tbodyRef.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) rowHadFocus.current = false;
                      }}
                      onKeyDown={(e) => onRowKeyDown(e, i, row)}
                      onClick={(e) => onRowClick(e, row)}
                      className={cn("group/row outline-none focus-visible:[--row-bg:color-mix(in_oklab,var(--color-accent-soft)_35%,var(--color-background))]", ROW_BG, onRowOpen && "cursor-pointer")}
                    >
                      {tr.getVisibleCells().map((cell) => {
                        const kind = kindOf(cell.column.id);
                        const td = "h-11 border-b border-border bg-(--row-bg) px-3 align-middle transition-colors group-last/row:border-b-0 group-focus-visible/row:shadow-[inset_0_1px_0_var(--color-ring),inset_0_-1px_0_var(--color-ring)]";
                        if (kind === "select") {
                          return (
                            <td key={cell.id} className={cn(td, "sticky left-0 z-10 px-0")}>
                              <div className="flex items-center justify-center">
                                <Checkbox
                                  checked={selected}
                                  onClick={(e) => onCheckboxClick(e, i, row)}
                                  aria-label={`Select ${row.name ?? "this business"}`}
                                />
                              </div>
                            </td>
                          );
                        }
                        if (kind === "actions") {
                          return (
                            <td key={cell.id} className={cn(td, "sticky right-0 z-10 px-1.5 text-right shadow-[inset_1px_0_0_var(--color-border)]")}>
                              <div className="flex items-center justify-end" data-grid-ignore>
                                {rowActions?.(row)}
                              </div>
                            </td>
                          );
                        }
                        const key = cell.column.id as FieldKey;
                        const isName = key === "business_name";
                        const override = renderCellOverride?.[key];
                        return (
                          <td
                            key={cell.id}
                            className={cn(td, "overflow-hidden", isName && "sticky z-10 shadow-[inset_-1px_0_0_var(--color-border)]", NUMERIC_COLUMNS.has(key) && "text-right")}
                            style={isName ? { left: nameLeft } : undefined}
                          >
                            <div className={cn("flex min-w-0 items-center *:min-w-0", NUMERIC_COLUMNS.has(key) && "justify-end")}>
                              {override ? override(row) : renderBusinessCell(key, row, cellCtx)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {error && (
          <EmptyState
            icon={<CircleAlert />}
            title="Couldn't load these results"
            description={error}
            action={
              onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              )
            }
          />
        )}
        {showEmpty &&
          (total > 0 && query.page > 1 ? (
            <EmptyState
              title="This page is empty"
              description={`There are only ${pages} page${pages === 1 ? "" : "s"} of results now.`}
              action={
                <Button variant="outline" size="sm" onClick={() => onQueryChange({ ...query, page: 1 })}>
                  Go to first page
                </Button>
              }
            />
          ) : constrained ? (
            <EmptyState
              icon={<SearchX />}
              title="No businesses match"
              description="Try removing a filter or searching for something else."
              action={
                <Button variant="outline" size="sm" onClick={() => patch({ filters: clearFilters(query.filters, locked), search: undefined })}>
                  Clear filters and search
                </Button>
              }
            />
          ) : (
            (emptyState ?? <EmptyState icon={<SearchX />} title="Nothing here yet" description="Results will appear here." />)
          ))}
      </div>

      <GridPagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        rowsOnPage={rows.length}
        disabled={!!isLoading}
        onPageChange={(page) => onQueryChange({ ...query, page: Math.max(1, Math.min(pages, page)) })}
        onPageSizeChange={(size) => {
          patch({ pageSize: size });
          onPageSizeChange?.(size);
        }}
      >
        {attributions.length > 0 && <p className="text-[12px] text-muted-foreground/80">{attributions.join(" · ")}</p>}
      </GridPagination>

      <SelectionBar count={count} onClear={() => onSelectionChange(emptySelection())}>
        {selectionActions?.(selection, count)}
      </SelectionBar>
    </div>
  );
}
