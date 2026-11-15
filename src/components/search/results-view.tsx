"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  Download,
  ExternalLink,
  FolderPlus,
  LayoutTemplate,
  Mail,
  MoreHorizontal,
  PanelRight,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { BusinessRow, ListResponse, SearchJobDto } from "@/lib/api-types";
import { serializeListQuery, type ListQuery } from "@/lib/list-query";
import { api } from "@/lib/api-client";
import { formatDate, formatNumber, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice, Skeleton } from "@/components/ui/misc";
import { SegmentTabs } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataGrid, RowActionsMenu, emptySelection, explicitIds, resolveSelectionIds, selectionCount, type GridSelection } from "@/components/data-grid";
import { BusinessSheet } from "@/components/business/business-sheet";
import { useListQueryState } from "@/hooks/use-list-query-state";
import { useGridColumns } from "@/hooks/use-grid-columns";
import { ExportDialog } from "@/components/exports/export-dialog";
import { SaveToCollectionDialog } from "@/components/collections/save-to-collection-dialog";
import { ProposalDialog } from "@/components/proposals/proposal-dialog";
import { JobProgress, JobStatusBadge, isActiveJob } from "./job-status";

type Segment = "all" | "no_website" | "has_website";

const segmentOf = (q: ListQuery): Segment =>
  q.filters.has_website === false ? "no_website" : q.filters.has_website === true ? "has_website" : "all";

function useJob(jobId: string) {
  return useQuery({
    queryKey: ["search-job", jobId],
    queryFn: () => api<SearchJobDto>(`/api/v1/search-jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data && isActiveJob(q.state.data.status) ? 1500 : false),
  });
}

function RowMenu({ row, onOpen, onProposal, onSave }: { row: BusinessRow; onOpen: () => void; onProposal: () => void; onSave: () => void }) {
  return (
    <RowActionsMenu label={`Actions for ${row.name ?? "business"}`}>
      <DropdownMenuItem onSelect={onOpen}>
        <PanelRight /> View details
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onProposal}>
        <Mail /> Write proposal
      </DropdownMenuItem>
      {row.websiteStatus === "none" && (
        <DropdownMenuItem asChild>
          <Link href={`/concepts/new?ref_kind=result&ref_id=${row.id}`}>
            <LayoutTemplate /> Draft a homepage concept
          </Link>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={onSave}>
        <FolderPlus /> Save to collection
      </DropdownMenuItem>
      {row.mapsUrl && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={row.mapsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open in Google Maps
            </a>
          </DropdownMenuItem>
        </>
      )}
    </RowActionsMenu>
  );
}

export function ResultsView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const job = useJob(jobId);
  const grid = useGridColumns("results");
  const { query, setQuery } = useListQueryState("results", { defaults: grid.pageSize ? { pageSize: grid.pageSize } : undefined });
  const [selection, setSelection] = React.useState<GridSelection>(emptySelection());
  const [openRow, setOpenRow] = React.useState<BusinessRow | null>(null);
  const [proposalRow, setProposalRow] = React.useState<BusinessRow | null>(null);
  const [saveTarget, setSaveTarget] = React.useState<{ ids: string[] | null; count: number } | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const active = job.data ? isActiveJob(job.data.status) : false;
  const qs = serializeListQuery(query).toString();
  const results = useQuery({
    queryKey: ["results", jobId, qs],
    queryFn: () => api<ListResponse>(`/api/v1/search-jobs/${jobId}/results?${qs}`),
    placeholderData: keepPreviousData,
    refetchInterval: active ? 3000 : false,
    enabled: Boolean(job.data) && !job.data?.resultsPurged,
  });


  // Refresh the counts on the tabs when the job finishes.
  const status = job.data?.status;
  React.useEffect(() => {
    if (status && !isActiveJob(status)) qc.invalidateQueries({ queryKey: ["results", jobId] });
  }, [status, jobId, qc]);

  const cancel = useMutation({
    mutationFn: () => api<SearchJobDto>(`/api/v1/search-jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: (j) => {
      qc.setQueryData(["search-job", jobId], j);
      toast.message("Stopping the search…", { description: "Results found so far are kept." });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not cancel"),
  });
  const del = useMutation({
    mutationFn: () => api<void>(`/api/v1/search-jobs/${jobId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["search-jobs"] });
      toast.success("Search deleted");
      router.push("/searches");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  const total = results.data?.total ?? 0;
  const count = selectionCount(selection, total);
  const fetchAllIds = React.useCallback(async () => {
    const res = await api<{ ids: string[] }>(`/api/v1/search-jobs/${jobId}/results/ids?${serializeListQuery({ ...query, page: 1 }).toString()}`);
    return res.ids;
  }, [jobId, query]);

  if (job.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (job.error || !job.data) {
    return <Notice tone="danger" icon={<TriangleAlert />}>{job.error?.message ?? "This search could not be loaded."}</Notice>;
  }

  const j = job.data;
  const c = j.counts;
  const policies = results.data?.policies ?? [];
  const segment = segmentOf(query);
  const setSegment = (s: Segment) => {
    const filters = { ...query.filters };
    if (s === "all") delete filters.has_website;
    else filters.has_website = s === "has_website";
    setQuery({ ...query, filters, page: 1 });
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-4">
        <Link href="/searches" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Searches
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{j.query}</h1>
              <JobStatusBadge status={j.status} />
              {j.provider === "sample" && <Badge variant="warning">Sample data</Badge>}
            </div>
            <p className="truncate text-[13px] text-muted-foreground">
              {j.location.label} · target {formatNumber(j.targetCount)} · started {formatRelative(j.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {active && (
              <Button variant="outline" size="sm" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                <Square /> Stop
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={!total}>
              <Download /> Export
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <Link href="/search">
                    <Plus /> New search
                  </Link>
                </DropdownMenuItem>
                {j.sourceUrl && (
                  <DropdownMenuItem asChild>
                    <a href={j.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Open original Maps link
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete search
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <JobProgress job={j} />
        {j.status === "failed" && j.error && <Notice tone="danger" icon={<TriangleAlert />}>{j.error}</Notice>}
        {j.resultsPurged ? (
          <Notice tone="warning" icon={<Clock />}>
            These results have expired and were deleted, as Google’s terms require. Leads you saved to collections are still there. Run the search again to see fresh results.
          </Notice>
        ) : (
          j.resultsExpireAt &&
          j.provider !== "sample" && (
            <Notice icon={<Clock />}>
              Google results are kept until {formatDate(j.resultsExpireAt, { dateStyle: "medium", timeStyle: "short" })}. Save the leads you want to keep to a collection.
            </Notice>
          )
        )}
      </div>

      {!j.resultsPurged && (
        <>
          <SegmentTabs<Segment>
            value={segment}
            onChange={setSegment}
            items={[
              { value: "all", label: "All", count: c?.total ?? null },
              { value: "no_website", label: "No website", count: c?.withoutWebsite ?? null },
              { value: "has_website", label: "Has website", count: c?.withWebsite ?? null },
            ]}
          />
          {segment === "no_website" && (c?.withoutWebsite ?? 0) > 0 && (
            <p className="-mt-2 text-[13px] text-muted-foreground">
              These businesses have no website listed — the best candidates for a website proposal or a free homepage concept.
            </p>
          )}

          <DataGrid
            context="results"
            rows={results.data?.rows ?? []}
            total={total}
            isLoading={results.isLoading}
            isFetching={results.isFetching}
            error={results.error?.message ?? null}
            onRetry={() => results.refetch()}
            query={query}
            onQueryChange={setQuery}
            columns={grid.columns}
            onColumnsChange={grid.setColumns}
            onResetColumns={grid.resetColumns}
            onPageSizeChange={grid.setPageSize}
            selection={selection}
            onSelectionChange={setSelection}
            facets={results.data?.facets}
            policies={policies}
            onRowOpen={setOpenRow}
            activeRowId={openRow?.id}
            lockedFilters={["has_website"]}
            enrichmentInProgress={j.status === "enriching" || j.status === "searching"}
            searchPlaceholder="Search name, phone, email, address…"
            aria-label="Search results"
            rowActions={(row) => (
              <RowMenu
                row={row}
                onOpen={() => setOpenRow(row)}
                onProposal={() => setProposalRow(row)}
                onSave={() => setSaveTarget({ ids: [row.id], count: 1 })}
              />
            )}
            selectionActions={() => (
              <>
                <Button size="sm" onClick={() => setSaveTarget({ ids: explicitIds(selection), count })}>
                  <FolderPlus /> Save to collection
                </Button>
                <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
                  <Download /> Export
                </Button>
              </>
            )}
            emptyState={
              active ? (
                <div className="py-14 text-center text-sm text-muted-foreground">Results will appear here as they’re found…</div>
              ) : undefined
            }
          />
        </>
      )}

      <BusinessSheet
        row={openRow}
        open={openRow !== null}
        onOpenChange={(o) => !o && setOpenRow(null)}
        policies={policies}
        enrichmentInProgress={j.status === "enriching" || j.status === "searching"}
        actions={
          openRow && (
            <>
              <Button size="sm" onClick={() => setProposalRow(openRow)}>
                <Mail /> Write proposal
              </Button>
              {openRow.websiteStatus === "none" && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/concepts/new?ref_kind=result&ref_id=${openRow.id}`}>
                    <LayoutTemplate /> Homepage concept
                  </Link>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setSaveTarget({ ids: [openRow.id], count: 1 })}>
                <FolderPlus /> Save
              </Button>
            </>
          )
        }
      />

      {proposalRow && (
        <ProposalDialog
          open
          onOpenChange={(o) => !o && setProposalRow(null)}
          businessRef={{ kind: "result", id: proposalRow.id }}
          business={proposalRow}
        />
      )}

      <SaveToCollectionDialog
        open={saveTarget !== null}
        onOpenChange={(o) => !o && setSaveTarget(null)}
        jobId={jobId}
        resultIds={saveTarget?.ids ?? null}
        query={query}
        count={saveTarget?.count ?? 0}
        resolveIds={selection.mode === "all_filtered" && selection.excludedIds.length > 0 ? () => resolveSelectionIds(selection, fetchAllIds) : undefined}
        onSaved={() => setSelection(emptySelection())}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        target="search"
        jobId={jobId}
        context="results"
        query={query}
        visibleColumns={grid.columns}
        total={total}
        pageRowCount={results.data?.rows.length ?? 0}
        selectedCount={count}
        resolveSelectedIds={() => resolveSelectionIds(selection, fetchAllIds)}
        policies={policies}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this search?</DialogTitle>
            <DialogDescription>Its results will be deleted. Leads you already saved to collections are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={del.isPending} onClick={() => del.mutate()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
