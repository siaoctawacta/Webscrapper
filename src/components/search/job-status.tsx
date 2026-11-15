"use client";
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, TriangleAlert, XCircle } from "lucide-react";
import type { SearchJobDto } from "@/lib/api-types";
import type { JobStatus } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { formatNumber } from "@/lib/utils";

const LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  searching: "Searching",
  enriching: "Checking websites",
  completed: "Completed",
  partial: "Partly completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case "queued":
      return <Badge variant="outline"><CircleDashed /> {LABELS[status]}</Badge>;
    case "searching":
    case "enriching":
      return <Badge variant="accent"><Loader2 className="animate-spin" /> {LABELS[status]}</Badge>;
    case "completed":
      return <Badge variant="success"><CheckCircle2 /> {LABELS[status]}</Badge>;
    case "partial":
      return <Badge variant="warning"><TriangleAlert /> {LABELS[status]}</Badge>;
    case "failed":
      return <Badge variant="danger"><XCircle /> {LABELS[status]}</Badge>;
    case "cancelled":
      return <Badge variant="default"><CircleSlash /> {LABELS[status]}</Badge>;
  }
}

export const isActiveJob = (s: JobStatus) => s === "queued" || s === "searching" || s === "enriching";

/** Overall completion 0–100: searching counts for 70%, website checks for 30% (when enabled). */
/** Progress is saved at most once per second; the live result count can be ahead of it. */
const foundSoFar = (job: SearchJobDto) => Math.max(job.progress.unique, job.counts?.total ?? 0);

export function jobPercent(job: SearchJobDto): number {
  const p = job.progress;
  if (!isActiveJob(job.status)) return 100;
  const searchPart = Math.min(1, foundSoFar(job) / Math.max(1, job.targetCount));
  const enrichPart = p.enrichTotal > 0 ? p.enriched / p.enrichTotal : 0;
  if (!job.enrich) return Math.round(searchPart * 100);
  if (job.status === "enriching") return Math.round(70 + enrichPart * 30);
  return Math.round(searchPart * 70);
}

export function JobProgress({ job }: { job: SearchJobDto }) {
  const p = job.progress;
  const active = isActiveJob(job.status);
  let line: string;
  if (job.status === "queued") line = "Waiting for a worker to pick up this search…";
  else if (job.status === "searching")
    line = `Found ${formatNumber(foundSoFar(job))} of ${formatNumber(job.targetCount)}${p.tilesTotal > 1 ? ` · map area ${formatNumber(p.tilesDone)}/${formatNumber(p.tilesTotal)}` : ""}`;
  else if (job.status === "enriching") line = `Checking websites for emails ${formatNumber(p.enriched)}/${formatNumber(p.enrichTotal)}`;
  else line = job.stopReason ?? p.message ?? "";
  return (
    <div className="grid gap-2">
      {active && <Progress value={jobPercent(job)} indeterminate={job.status === "queued"} />}
      {line && <p className="text-[13px] text-muted-foreground tabular">{line}</p>}
    </div>
  );
}
