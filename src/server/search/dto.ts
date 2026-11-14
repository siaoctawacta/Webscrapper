/**
 * SearchJob row → API DTO. Pure (no DB) so it can be unit tested and reused.
 */
import type { CostEstimate, SearchJobDto } from "@/lib/api-types";
import type { SourceId } from "@/lib/domain";
import type { SearchJob } from "../db/schema";
import type { CostEstimateResult } from "../providers/types";

export type JobCounts = NonNullable<SearchJobDto["counts"]>;

export const emptyCounts = (): JobCounts => ({ total: 0, withWebsite: 0, withoutWebsite: 0, withEmail: 0, withPhone: 0 });

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toSearchJobDto(job: SearchJob, counts?: JobCounts): SearchJobDto {
  return {
    id: job.id,
    kind: job.kind,
    query: job.query,
    location: job.location,
    sourceUrl: job.sourceUrl,
    provider: job.provider,
    targetCount: job.targetCount,
    enrich: job.enrich,
    status: job.status,
    progress: job.progress,
    estimatedRequests: job.estimatedRequests,
    estimatedCostUsd: Number(job.estimatedCostUsd),
    actualRequests: job.actualRequests,
    stopReason: job.stopReason,
    error: job.error,
    resultsExpireAt: iso(job.resultsExpireAt),
    resultsPurged: job.resultsPurgedAt !== null,
    createdAt: job.createdAt.toISOString(),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    ...(counts ? { counts } : {}),
  };
}

/** Round to 4 decimals (the precision stored in the database). */
export const roundUsd = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 10_000) / 10_000;

export function toCostEstimate(
  provider: { id: SourceId; isSample: boolean },
  e: CostEstimateResult,
  confirmThresholdUsd: number,
  extraNotes: string[] = [],
): CostEstimate {
  const cost = roundUsd(e.estimatedCostUsd);
  return {
    provider: provider.id,
    isSample: provider.isSample,
    estimatedRequests: e.estimatedRequests,
    maxRequests: e.maxRequests,
    estimatedCostUsd: cost,
    freeMonthlyRequests: e.freeMonthlyRequests,
    requiresConfirmation: !provider.isSample && cost > confirmThresholdUsd,
    notes: [...e.notes, ...extraNotes],
  };
}
