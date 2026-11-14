"use client";
import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import type { AuditEntryDto, AuditLogResponse } from "@/server/admin/types";
import { TimeText } from "./time-text";

const ALL = "__all";

const OUTCOME: Record<AuditEntryDto["outcome"], { label: string; variant: "success" | "warning" | "danger" }> = {
  success: { label: "Success", variant: "success" },
  denied: { label: "Denied", variant: "warning" },
  error: { label: "Error", variant: "danger" },
};

/** One-line JSON, shortened for the table. */
export function compactJson(v: Record<string, unknown>, max = 90): string {
  if (!v || Object.keys(v).length === 0) return "";
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function AuditLogPanel({ initialData, initialAction }: { initialData: AuditLogResponse; initialAction: string | null }) {
  const [page, setPage] = React.useState(initialData.page);
  const [action, setAction] = React.useState(initialAction ?? "");
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());
  const isInitial = page === initialData.page && action === (initialAction ?? "");

  const { data = initialData, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["admin", "audit", page, action],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (page > 1) qs.set("page", String(page));
      if (action) qs.set("action", action);
      const s = qs.toString();
      return api<AuditLogResponse>(`/api/v1/admin/audit${s ? `?${s}` : ""}`);
    },
    initialData: isInitial ? initialData : undefined,
    placeholderData: keepPreviousData,
  });

  // Keep the URL in sync so a reload or a shared link shows the same page.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (page > 1) url.searchParams.set("page", String(page));
    else url.searchParams.delete("page");
    if (action) url.searchParams.set("action", action);
    else url.searchParams.delete("action");
    window.history.replaceState(window.history.state, "", url);
  }, [page, action]);

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);
  const filterId = React.useId();

  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const prefixOptions = [
    { value: ALL, label: "All activity" },
    ...[...new Set([...data.prefixes, ...(action ? [action] : [])])].sort().map((p) => ({ value: p, label: `${p}.*` })),
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1.5 sm:w-64">
          <Label htmlFor={filterId}>Action</Label>
          <Select
            id={filterId}
            size="sm"
            value={action || ALL}
            onValueChange={(v) => {
              setAction(v === ALL ? "" : v);
              setPage(1);
              setExpanded(new Set());
            }}
            options={prefixOptions}
            aria-label="Filter by action"
          />
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {data.total === 0 ? "No entries" : `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(data.total)}`}
          {isFetching && " · Loading…"}
        </p>
      </div>

      <Card className={cn("overflow-hidden transition-opacity", isPlaceholderData && "opacity-60")}>
        {data.entries.length === 0 ? (
          isFetching ? (
            <div className="grid gap-2 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ScrollText />}
              title={data.total > 0 ? "No entries on this page" : action ? "Nothing recorded for this action yet" : "The audit log is empty"}
              description="Changes by admins, invitations, settings updates, searches and exports are recorded here."
              action={
                data.total > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setPage(1)}>
                    Go to the newest entries
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <caption className="sr-only">Audit log, newest first</caption>
              <thead>
                <tr className="border-b border-border bg-subtle text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Actor</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Resource</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Outcome</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => {
                  const open = expanded.has(e.id);
                  const summary = compactJson(e.metadata);
                  const detailsId = `audit-details-${e.id}`;
                  return (
                    <React.Fragment key={e.id}>
                      <tr className={cn("border-b border-border align-top", open && "border-b-0 bg-subtle/60")}>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                          <TimeText iso={e.createdAt} mode="datetime" />
                        </td>
                        <td className="max-w-52 px-3 py-2.5">
                          {e.actor ? (
                            <>
                              <span className="block truncate">{e.actor.name || e.actor.email}</span>
                              {e.actor.name && <span className="block truncate text-xs text-muted-foreground">{e.actor.email}</span>}
                            </>
                          ) : (
                            <span className="text-muted-foreground">{e.actorId ? "Deleted user" : "System"}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{e.action}</code>
                        </td>
                        <td className="max-w-48 px-3 py-2.5">
                          <span className="block">{e.resourceType}</span>
                          {e.resourceId && (
                            <span className="block truncate font-mono text-[11px] text-muted-foreground" title={e.resourceId}>
                              {e.resourceId}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={OUTCOME[e.outcome].variant}>{OUTCOME[e.outcome].label}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          {summary || e.ip ? (
                            <button
                              type="button"
                              onClick={() => toggle(e.id)}
                              aria-expanded={open}
                              aria-controls={detailsId}
                              className="group flex max-w-64 items-start gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                            >
                              <ChevronDown
                                className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                                aria-hidden
                              />
                              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground group-hover:text-foreground">
                                {summary || "Show details"}
                              </span>
                              <span className="sr-only">{open ? "Hide details" : "Show details"}</span>
                            </button>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr id={detailsId} className="border-b border-border bg-subtle/60">
                          <td colSpan={6} className="px-4 pb-3 pt-0">
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                              {JSON.stringify(e.metadata, null, 2)}
                            </pre>
                            {e.ip && <p className="mt-1.5 text-xs text-muted-foreground">IP address: {e.ip}</p>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Audit log pages">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeft aria-hidden /> Newer
          </Button>
          <span className="tabular text-xs text-muted-foreground">
            Page {formatNumber(data.page)} of {formatNumber(pages)}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
            Older <ChevronRight aria-hidden />
          </Button>
        </nav>
      )}
    </div>
  );
}
