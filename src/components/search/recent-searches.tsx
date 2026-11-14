"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, History } from "lucide-react";
import type { SearchJobDto } from "@/lib/api-types";
import { api } from "@/lib/api-client";
import { formatNumber, formatRelative } from "@/lib/utils";
import { Skeleton, EmptyState } from "@/components/ui/misc";
import { JobStatusBadge, isActiveJob } from "./job-status";

export function useSearchJobs(page = 1, opts: { limit?: number } = {}) {
  return useQuery({
    queryKey: ["search-jobs", page],
    queryFn: () => api<{ jobs: SearchJobDto[]; total: number }>(`/api/v1/search-jobs?page=${page}`),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => isActiveJob(j.status)) ? 3000 : false),
    select: (d) => (opts.limit ? { ...d, jobs: d.jobs.slice(0, opts.limit) } : d),
  });
}

export function JobRow({ job }: { job: SearchJobDto }) {
  const c = job.counts;
  return (
    <Link
      href={`/searches/${job.id}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium">{job.query}</span>
          <JobStatusBadge status={job.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {job.location.label} · {formatRelative(job.createdAt)}
        </p>
      </div>
      <div className="hidden text-right text-xs text-muted-foreground tabular sm:block">
        {c ? (
          <>
            <span className="font-medium text-foreground">{formatNumber(c.total)}</span> found
            <span className="block">{formatNumber(c.withoutWebsite)} without website</span>
          </>
        ) : (
          <span>{formatNumber(job.progress.unique)} found</span>
        )}
      </div>
      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function RecentSearches() {
  const q = useSearchJobs(1, { limit: 5 });
  if (q.isLoading)
    return (
      <div className="grid gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  if (!q.data || q.data.jobs.length === 0) return null;
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-muted-foreground">Recent searches</h2>
        <Link href="/searches" className="text-[13px] text-accent hover:underline">
          View all
        </Link>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {q.data.jobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </div>
    </section>
  );
}

export function AllSearches() {
  const q = useSearchJobs(1);
  if (q.isLoading)
    return (
      <div className="grid gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  if (q.error) return <p className="text-sm text-destructive">{q.error.message}</p>;
  if (!q.data || q.data.jobs.length === 0)
    return (
      <EmptyState
        icon={<History />}
        title="No searches yet"
        description="Paste a Google Maps link or search by keyword to find businesses."
        action={
          <Link href="/search" className="text-[13px] font-medium text-accent hover:underline">
            Start a search
          </Link>
        }
      />
    );
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {q.data.jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  );
}
