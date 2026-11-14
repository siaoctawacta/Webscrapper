"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, Info, Loader2 } from "lucide-react";
import type { ExportDto, SourcePolicyInfo } from "@/lib/api-types";
import type { ExportFormat, ExportScope } from "@/lib/domain";
import { FIELDS, fieldsFor, type FieldContext, type FieldKey } from "@/lib/fields";
import type { ListQuery } from "@/lib/list-query";
import { api, ApiClientError } from "@/lib/api-client";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: "search" | "collection";
  jobId?: string;
  collectionId?: string;
  context: FieldContext;
  /** Current list query (filters + sort + page). */
  query: ListQuery;
  /** Visible grid columns, in order (default export layout). */
  visibleColumns: FieldKey[];
  total: number;
  pageRowCount: number;
  /** Number of selected rows (0 = none). */
  selectedCount: number;
  /** Resolve the selected row ids (may call the server for "all filtered" selections). */
  resolveSelectedIds: () => Promise<string[]>;
  policies?: SourcePolicyInfo[];
  defaultScope?: ExportScope;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(id: string, signal: AbortSignal): Promise<ExportDto> {
  for (let i = 0; i < 600; i++) {
    if (signal.aborted) throw new Error("Cancelled");
    const e = await api<ExportDto>(`/api/v1/exports/${id}`);
    if (e.status === "ready" || e.status === "failed" || e.status === "expired") return e;
    await sleep(Math.min(4000, 1000 + i * 250));
  }
  throw new Error("The export is taking longer than expected. You'll find it in your exports list.");
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportDialog(props: ExportDialogProps) {
  const { open, onOpenChange, context, visibleColumns, total, pageRowCount, selectedCount, policies } = props;
  const [format, setFormat] = React.useState<ExportFormat>("xlsx");
  const [scope, setScope] = React.useState<ExportScope>(props.defaultScope ?? (selectedCount > 0 ? "selected" : "filtered"));
  const [columns, setColumns] = React.useState<FieldKey[]>(visibleColumns);
  const [includeAnnotations, setIncludeAnnotations] = React.useState(true);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (open) {
      setColumns(visibleColumns.filter((c) => FIELDS[c].contexts.includes(context)));
      setScope(props.defaultScope ?? (selectedCount > 0 ? "selected" : "filtered"));
    } else abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allColumns = fieldsFor(context);
  const nonExportable = new Set((policies ?? []).flatMap((p) => p.nonExportableFields));
  const restrictedChosen = columns.filter((c) => nonExportable.has(c));
  const restrictedSources = (policies ?? []).filter((p) => p.nonExportableFields.length > 0).map((p) => p.label);

  const counts: Record<ExportScope, number> = { selected: selectedCount, page: pageRowCount, filtered: Math.min(total, 20000) };

  const run = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      const rowIds = scope === "selected" ? await props.resolveSelectedIds() : undefined;
      const ordered = allColumns.filter((c) => columns.includes(c));
      const sortedColumns = columns.filter((c) => ordered.includes(c));
      let exp = await api<ExportDto>("/api/v1/exports", {
        method: "POST",
        json: {
          target: props.target,
          jobId: props.jobId,
          collectionId: props.collectionId,
          format,
          scope,
          columns: sortedColumns,
          includeAnnotations: context === "collection" ? includeAnnotations : undefined,
          query: props.query,
          rowIds,
        },
      });
      if (exp.status !== "ready" || !exp.downloadUrl) {
        if (exp.status === "queued" || exp.status === "running") toast.message("Preparing your export…", { description: "Large exports take a little while." });
        exp = exp.status === "ready" ? await api<ExportDto>(`/api/v1/exports/${exp.id}`) : await waitForReady(exp.id, controller.signal);
      }
      if (exp.status !== "ready" || !exp.downloadUrl) throw new Error(exp.error ?? "The export could not be created.");
      return exp;
    },
    onSuccess: (exp) => {
      triggerDownload(exp.downloadUrl!);
      const excluded = exp.excludedFields.length ? ` Some columns were left out (${exp.excludedFields.map((f) => FIELDS[f.field as FieldKey]?.label ?? f.field).join(", ")}).` : "";
      toast.success(`Exported ${formatNumber(exp.rowCount ?? 0)} rows.${excluded}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiClientError || e instanceof Error ? e.message : "Export failed"),
  });

  const toggle = (k: FieldKey) => setColumns((cols) => (cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k]));

  return (
    <Dialog open={open} onOpenChange={(o) => !run.isPending && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>Download an Excel or CSV file with your chosen rows and columns, in the current sort order.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label>Rows</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["selected", "page", "filtered"] as const).map((s) => {
                const label = s === "selected" ? "Selected rows" : s === "page" ? "This page" : "All filtered rows";
                const disabled = counts[s] === 0;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => setScope(s)}
                    aria-pressed={scope === s}
                    className={cn(
                      "rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                      scope === s && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground tabular">{formatNumber(counts[s])} rows</span>
                  </button>
                );
              })}
            </div>
            {scope === "filtered" && total > 20000 && <p className="text-xs text-muted-foreground">Exports are limited to the first 20,000 rows in the current order.</p>}
          </div>

          <div className="grid gap-2">
            <Label>Format</Label>
            <div className="flex gap-2">
              {(
                [
                  ["xlsx", "Excel (.xlsx)", FileSpreadsheet],
                  ["csv", "CSV (UTF-8)", FileText],
                ] as const
              ).map(([f, label, Icon]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  aria-pressed={format === f}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-muted",
                    format === f && "border-primary ring-1 ring-primary",
                  )}
                >
                  <Icon className="size-4 text-muted-foreground" /> {label}
                </button>
              ))}
            </div>
            {format === "xlsx" && <p className="text-xs text-muted-foreground">Includes “Search Summary” and “Data Quality” sheets.</p>}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Columns</Label>
              <div className="flex gap-3 text-xs">
                <button type="button" className="text-accent hover:underline" onClick={() => setColumns(visibleColumns)}>
                  Visible columns
                </button>
                <button type="button" className="text-accent hover:underline" onClick={() => setColumns(allColumns)}>
                  All
                </button>
              </div>
            </div>
            <div className="grid max-h-56 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
              {allColumns.map((k) => (
                <label key={k} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={columns.includes(k)} onCheckedChange={() => toggle(k)} />
                  <span className={cn(nonExportable.has(k) && "text-muted-foreground")}>{FIELDS[k].label}</span>
                </label>
              ))}
            </div>
          </div>

          {context === "collection" && (
            <label className="flex items-center gap-3">
              <Switch checked={includeAnnotations} onCheckedChange={setIncludeAnnotations} />
              <span className="text-[13px]">Include lead status, tags and notes</span>
            </label>
          )}

          {restrictedChosen.length > 0 && (
            <Notice icon={<Info />}>
              {restrictedSources.join(", ")} terms don’t allow exporting {restrictedChosen.map((c) => FIELDS[c].label.toLowerCase()).join(", ")} for those rows. Those cells stay empty; the Google Maps link, place ID, emails found on websites and your notes are included.
            </Notice>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={run.isPending}>
            Cancel
          </Button>
          <Button onClick={() => run.mutate()} disabled={columns.length === 0 || counts[scope] === 0} loading={run.isPending}>
            {run.isPending ? <Loader2 className="hidden" /> : <Download />} Export {formatNumber(counts[scope])} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
