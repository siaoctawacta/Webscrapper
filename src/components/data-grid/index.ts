/**
 * Shared server-driven data grid for search results and collection leads.
 *
 * The server sorts, filters and paginates; the grid only renders a page of rows and reports the
 * next ListQuery. Typical page wiring (wrap the component in <Suspense> — the URL hook uses
 * useSearchParams):
 *
 *   const prefs = useGridColumns("results");
 *   const { query, setQuery } = useListQueryState("results", { defaults: { pageSize: prefs.pageSize } });
 *   const [selection, setSelection] = React.useState<GridSelection>(emptySelection());
 *   const [openRow, setOpenRow] = React.useState<BusinessRow | null>(null);
 *   const res = useQuery({
 *     queryKey: ["results", jobId, query],
 *     queryFn: () => api<ListResponse>(`/api/v1/search-jobs/${jobId}/results?${serializeListQuery(query)}`),
 *     placeholderData: keepPreviousData,
 *   });
 *
 *   <DataGrid
 *     context="results"
 *     rows={res.data?.rows ?? []}
 *     total={res.data?.total ?? 0}
 *     isLoading={res.isPending}
 *     isFetching={res.isFetching}
 *     error={res.error?.message}
 *     onRetry={() => res.refetch()}
 *     query={query}
 *     onQueryChange={setQuery}
 *     onPageSizeChange={prefs.setPageSize}
 *     columns={prefs.columns}
 *     onColumnsChange={prefs.setColumns}
 *     onResetColumns={prefs.resetColumns}
 *     selection={selection}
 *     onSelectionChange={setSelection}
 *     facets={res.data?.facets}
 *     policies={res.data?.policies}
 *     onRowOpen={setOpenRow}
 *     activeRowId={openRow?.id}
 *     lockedFilters={["has_website"]}            // when page tabs control it
 *     rowActions={(row) => <RowActionsMenu>…DropdownMenuItem…</RowActionsMenu>}
 *     renderCellOverride={{ lead_status: (row) => <StatusEditor row={row} /> }}
 *     selectionActions={(sel, count) => <Button size="xs">Save {count}</Button>}
 *   />
 *   <BusinessSheet row={openRow} open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)} policies={res.data?.policies}
 *     actions={<Button size="sm">Write proposal</Button>}>
 *     {optionalEditablePanel}
 *   </BusinessSheet>
 *
 * Selection: `{ mode: "ids", ids }` or `{ mode: "all_filtered", excludedIds }` — use
 * `explicitIds(sel)` (null = "everything matching the query", send `{ query }`) or
 * `resolveSelectionIds(sel, fetchAllIds)` to get concrete ids. The selection is cleared when
 * filters or search change unless `preserveSelectionOnFilterChange` is set.
 *
 * Keyboard: rows are focusable (arrow keys / Home / End move), Enter or Space opens the row,
 * x toggles its selection; Shift+click on a header adds a secondary sort (up to 3), Shift+click
 * on a checkbox selects a range.
 */
export { DataGrid, type DataGridProps } from "./data-grid";
export { RowActionsMenu } from "./row-actions-menu";
export { QuickSearch } from "./quick-search";
export { FiltersPanel, type FiltersPanelProps } from "./filters-panel";
export { ColumnsPanel } from "./columns-panel";
export { GridPagination, type PageSize } from "./pagination";
export { SelectionBanner, SelectionBar } from "./selection-bar";
export { FilterChips, SortChips } from "./active-bar";
export * from "./selection";
export * from "./sorting";
export * from "./columns";
export * from "./filters";
export * from "./query";
