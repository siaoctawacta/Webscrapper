"use client";
import * as React from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, ExternalLink, Info, LayoutTemplate, Mail, PanelRight, Pencil, Search, Trash2, TriangleAlert } from "lucide-react";
import type { BusinessRow, CollectionDto, ListResponse } from "@/lib/api-types";
import { serializeListQuery } from "@/lib/list-query";
import { api } from "@/lib/api-client";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { DataGrid, RowActionsMenu, emptySelection, explicitIds, resolveSelectionIds, selectionCount, type GridSelection } from "@/components/data-grid";
import { BusinessSheet } from "@/components/business/business-sheet";
import { useListQueryState } from "@/hooks/use-list-query-state";
import { useGridColumns } from "@/hooks/use-grid-columns";
import { ExportDialog } from "@/components/exports/export-dialog";
import { ProposalDialog } from "@/components/proposals/proposal-dialog";
import { CollectionFormDialog } from "./collections-list";
import { BulkActions } from "./bulk-bar";
import { LeadNotesEditor, LeadStatusSelect, LeadTagsCell, TagEditor, useLeadUpdate } from "./lead-editors";

export function CollectionView({ collectionId }: { collectionId: string }) {
  const qc = useQueryClient();
  const grid = useGridColumns("collection");
  const { query, setQuery } = useListQueryState("collection", { defaults: grid.pageSize ? { pageSize: grid.pageSize } : undefined });
  const [selection, setSelection] = React.useState<GridSelection>(emptySelection());
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [proposalRow, setProposalRow] = React.useState<BusinessRow | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);

  const collection = useQuery({
    queryKey: ["collection", collectionId],
    queryFn: () => api<CollectionDto>(`/api/v1/collections/${collectionId}`),
  });
  const qs = serializeListQuery(query).toString();
  const leadsKey = ["leads", collectionId, qs] as const;
  const leads = useQuery({
    queryKey: leadsKey,
    queryFn: () => api<ListResponse>(`/api/v1/collections/${collectionId}/leads?${qs}`),
    placeholderData: keepPreviousData,
  });


  /** Replace one row in the cached page after an inline edit (no refetch → no live re-hydration cost). */
  const patchRow = React.useCallback(
    (updated: BusinessRow) => {
      qc.setQueryData<ListResponse>(leadsKey, (old) =>
        old ? { ...old, rows: old.rows.map((r) => (r.id === updated.id ? { ...r, lead: updated.lead } : r)) } : old,
      );
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["collection", collectionId] });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, qs, collectionId],
  );

  const removeOne = useMutation({
    mutationFn: (leadId: string) => api<void>(`/api/v1/leads/${leadId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads", collectionId] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success("Removed from collection");
      setOpenId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove"),
  });

  const rows = leads.data?.rows ?? [];
  const total = leads.data?.total ?? 0;
  const count = selectionCount(selection, total);
  const tagSuggestions = (leads.data?.facets.tags ?? []).map((t) => t.value);
  const policies = leads.data?.policies ?? [];
  const openRow = rows.find((r) => r.id === openId) ?? null;
  const hasRestricted = rows.some((r) => r.restrictedFields.length > 0);
  const hasLive = rows.some((r) => r.liveFields.length > 0);
  const fetchAllIds = React.useCallback(async () => {
    const res = await api<{ ids: string[] }>(`/api/v1/collections/${collectionId}/leads/ids?${serializeListQuery({ ...query, page: 1 }).toString()}`);
    return res.ids;
  }, [collectionId, query]);

  const ids = explicitIds(selection);
  const selector = ids ? { leadIds: ids } : selection.mode === "all_filtered" && selection.excludedIds.length === 0 ? { query } : null;

  if (collection.error) return <Notice tone="danger" icon={<TriangleAlert />}>{collection.error.message}</Notice>;

  return (
    <div className="grid gap-5">
      <Link href="/collections" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Collections
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 gap-1">
          {collection.data ? (
            <>
              <h1 className="truncate text-xl font-semibold tracking-tight">{collection.data.name}</h1>
              <p className="text-[13px] text-muted-foreground">
                {formatNumber(collection.data.leadCount)} leads{collection.data.description ? ` · ${collection.data.description}` : ""}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-40" />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={!total}>
            <Download /> Export
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit collection" onClick={() => setEditOpen(true)} disabled={!collection.data}>
            <Pencil />
          </Button>
        </div>
      </div>

      {leads.data?.liveDetailsLimited && (
        <Notice tone="warning" icon={<TriangleAlert />}>
          Your monthly Google request limit is reached, so some names, phones and addresses can’t be loaded live until next month. Your own notes, tags and statuses are unaffected. An admin can raise your limit.
        </Notice>
      )}
      {hasRestricted && !leads.data?.liveDetailsLimited && (
        <Notice icon={<Info />}>
          {hasLive
            ? "Names, phones and addresses of Google Maps leads are loaded live for this page (Google doesn’t allow storing them). Your status, tags, notes and the emails found on websites are saved."
            : "Some details of Google Maps leads aren’t stored (Google’s terms) and couldn’t be loaded live right now — check that the Google Maps key is configured."}
        </Notice>
      )}

      <DataGrid
        context="collection"
        rows={rows}
        total={total}
        isLoading={leads.isLoading}
        isFetching={leads.isFetching}
        error={leads.error?.message ?? null}
        onRetry={() => leads.refetch()}
        query={query}
        onQueryChange={setQuery}
        columns={grid.columns}
        onColumnsChange={grid.setColumns}
        onResetColumns={grid.resetColumns}
        onPageSizeChange={grid.setPageSize}
        selection={selection}
        onSelectionChange={setSelection}
        facets={leads.data?.facets}
        policies={policies}
        onRowOpen={(r) => setOpenId(r.id)}
        activeRowId={openId}
        searchPlaceholder="Search name, notes, tags, email…"
        aria-label="Leads"
        renderCellOverride={{
          lead_status: (row) => <LeadStatusSelect row={row} onUpdated={patchRow} />,
          tags: (row) => <LeadTagsCell row={row} suggestions={tagSuggestions} onUpdated={patchRow} />,
        }}
        rowActions={(row) => (
          <RowActionsMenu label={`Actions for ${row.name ?? "lead"}`}>
            <DropdownMenuItem onSelect={() => setOpenId(row.id)}>
              <PanelRight /> View & edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setProposalRow(row)}>
              <Mail /> Write proposal
            </DropdownMenuItem>
            {row.websiteStatus === "none" && (
              <DropdownMenuItem asChild>
                <Link href={`/concepts/new?ref_kind=lead&ref_id=${row.id}`}>
                  <LayoutTemplate /> Draft a homepage concept
                </Link>
              </DropdownMenuItem>
            )}
            {row.mapsUrl && (
              <DropdownMenuItem asChild>
                <a href={row.mapsUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open in Google Maps
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => removeOne.mutate(row.id)}>
              <Trash2 /> Remove from collection
            </DropdownMenuItem>
          </RowActionsMenu>
        )}
        selectionActions={() =>
          selector ? (
            <BulkActions collectionId={collectionId} selector={selector} count={count} tagSuggestions={tagSuggestions} onDone={() => setSelection(emptySelection())} />
          ) : (
            <BulkActionsResolver
              key={JSON.stringify([selection, qs])}
              collectionId={collectionId}
              count={count}
              tagSuggestions={tagSuggestions}
              resolve={() => resolveSelectionIds(selection, fetchAllIds)}
              onDone={() => setSelection(emptySelection())}
            />
          )
        }
        emptyState={
          !query.search && Object.keys(query.filters).length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="No leads yet"
              description="Open a search, select businesses and choose “Save to collection”."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/searches">Go to searches</Link>
                </Button>
              }
            />
          ) : undefined
        }
      />

      <BusinessSheet
        row={openRow}
        open={openRow !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        policies={policies}
        actions={
          openRow && (
            <>
              <Button size="sm" onClick={() => setProposalRow(openRow)}>
                <Mail /> Write proposal
              </Button>
              {openRow.websiteStatus === "none" && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/concepts/new?ref_kind=lead&ref_id=${openRow.id}`}>
                    <LayoutTemplate /> Homepage concept
                  </Link>
                </Button>
              )}
            </>
          )
        }
      >
        {openRow && <LeadPanel row={openRow} suggestions={tagSuggestions} onUpdated={patchRow} />}
      </BusinessSheet>

      {proposalRow && (
        <ProposalDialog
          open
          onOpenChange={(o) => !o && setProposalRow(null)}
          businessRef={{ kind: "lead", id: proposalRow.id }}
          business={proposalRow}
          onSent={() => qc.invalidateQueries({ queryKey: ["leads", collectionId] })}
        />
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        target="collection"
        collectionId={collectionId}
        context="collection"
        query={query}
        visibleColumns={grid.columns}
        total={total}
        pageRowCount={rows.length}
        selectedCount={count}
        resolveSelectedIds={() => resolveSelectionIds(selection, fetchAllIds)}
        policies={policies}
      />

      <CollectionFormDialog open={editOpen} onOpenChange={setEditOpen} initial={collection.data ?? null} />
    </div>
  );
}

/** "All filtered except a few" can't be sent as a query: resolve ids first, then show the actions. */
function BulkActionsResolver(props: { collectionId: string; count: number; tagSuggestions: string[]; resolve: () => Promise<string[]>; onDone: () => void }) {
  const [ids, setIds] = React.useState<string[] | null>(null);
  // Resolve once per mount; the parent remounts this (via `key`) when the selection or query changes.
  const resolveRef = React.useRef(props.resolve);
  React.useEffect(() => {
    let alive = true;
    resolveRef.current().then((r) => alive && setIds(r)).catch(() => alive && setIds([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!ids) return <span className="text-xs text-muted-foreground">Preparing selection…</span>;
  return <BulkActions collectionId={props.collectionId} selector={{ leadIds: ids }} count={ids.length} tagSuggestions={props.tagSuggestions} onDone={props.onDone} />;
}

function LeadPanel({ row, suggestions, onUpdated }: { row: BusinessRow; suggestions: string[]; onUpdated: (r: BusinessRow) => void }) {
  const update = useLeadUpdate(onUpdated);
  return (
    <section className="grid gap-4 rounded-lg border border-border p-4">
      <h3 className="text-[13px] font-semibold">Your lead</h3>
      <div className="grid gap-1.5">
        <Label>Status</Label>
        <div>
          <LeadStatusSelect row={row} onUpdated={onUpdated} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Tags</Label>
        <TagEditor tags={row.lead?.tags ?? []} suggestions={suggestions} onChange={(tags) => update.mutate({ leadId: row.id, patch: { tags } })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Notes</Label>
        <LeadNotesEditor key={row.id} row={row} onUpdated={onUpdated} />
      </div>
    </section>
  );
}
