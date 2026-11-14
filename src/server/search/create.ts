import "server-only";
import { and, eq } from "drizzle-orm";
import type { CostEstimate, SearchJobDto } from "@/lib/api-types";
import { emptyProgress } from "@/lib/domain";
import { validateFilters, validateSort, type Filters, type SortSpec } from "@/lib/list-query";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { jobEvents, searchJobs, type SearchJob } from "../db/schema";
import { env } from "../env";
import { HttpError } from "../errors";
import type { resolveMapsLink } from "../maps-link";
import { enqueue as enqueueJob } from "../queue";
import { rateLimit } from "../rate-limit";
import { defaultProviderId, getProvider } from "../providers/registry";
import type { BusinessProvider } from "../providers/types";
import { billableRequestsThisMonth } from "../usage";
import { emptyCounts, toCostEstimate, toSearchJobDto } from "./dto";
import { jobDtoWithCounts } from "./jobs";
import {
  clampMessage,
  clampTarget,
  confirmationMessage,
  monthlyLimitMessage,
  remainingAllowanceNote,
} from "./limits";
import { assertJobSlots, getUserSearchLimits, type UserSearchLimits } from "./quotas";
import { parseCreateSearchInput, type CreateSearchInput } from "./schemas";
import { resolveSearchTarget, type ResolvedSearch } from "./target";
import { UsageRecorder } from "./usage-recorder";

export const GOOGLE_NOT_CONFIGURED_MESSAGE =
  "Google Maps isn't set up on this server yet, so only sample data is available. Ask an administrator to add a Google Maps API key.";
export const QUEUE_UNAVAILABLE_MESSAGE = "We couldn't start the search right now because the background worker queue is unavailable. Please try again in a moment.";

/**
 * How long the queue lets one search run before treating it as overrun. Large Google searches with
 * thousands of website visits can take an hour; the runner itself never gives up mid-way.
 */
export const SEARCH_RUN_EXPIRE_SECONDS = 6 * 3600;

export type SearchDeps = {
  /** Use this provider instead of the registry (tests). */
  provider?: BusinessProvider;
  resolveLink?: typeof resolveMapsLink;
  enqueue?: typeof enqueueJob;
};

type UserRef = Pick<AppUser, "id">;

type Prepared = {
  input: CreateSearchInput;
  provider: BusinessProvider;
  target: ResolvedSearch;
  requestedCount: number;
  targetCount: number;
  clamped: boolean;
  filters: Filters;
  sort: SortSpec[];
  limits: UserSearchLimits;
  estimate: CostEstimate;
  /** Billable requests used this month (before this job), when relevant. */
  usedThisMonth: number;
};

function selectProvider(input: CreateSearchInput, deps: SearchDeps): BusinessProvider {
  if (deps.provider) return deps.provider;
  const id = input.provider ?? defaultProviderId();
  if (id === "google_places" && !env().GOOGLE_MAPS_API_KEY) throw new HttpError("validation_failed", GOOGLE_NOT_CONFIGURED_MESSAGE);
  return getProvider(id);
}

const isBillable = (p: BusinessProvider) => !p.isSample;

async function prepare(
  user: UserRef,
  input: CreateSearchInput,
  deps: SearchDeps,
  opts: { mode: "estimate" | "create"; usage?: UsageRecorder; limits?: UserSearchLimits; provider?: BusinessProvider },
): Promise<Prepared> {
  // ListQueryError → 422 through errorResponse.
  const filters = validateFilters(input.filters, "results");
  const sort = validateSort(input.sort, "results");
  const provider = opts.provider ?? selectProvider(input, deps);
  const limits = opts.limits ?? (await getUserSearchLimits(user.id));

  const target = await resolveSearchTarget(input, provider, {
    resolveLink: deps.resolveLink,
    onUsage: opts.usage?.onUsage,
    // The live estimate never spends billable requests on geocoding.
    geocode: opts.mode === "create" || provider.isSample,
  });

  const requestedCount = target.singlePlace ? 1 : input.targetCount;
  const { targetCount, clamped } = target.singlePlace ? { targetCount: 1, clamped: false } : clampTarget(requestedCount, limits.maxResultsPerSearch);
  const raw = provider.estimate(targetCount);

  const notes: string[] = [];
  if (clamped) notes.push(clampMessage(limits.maxResultsPerSearch, requestedCount));
  let usedThisMonth = 0;
  if (isBillable(provider) && limits.monthlyRequestLimit > 0) {
    usedThisMonth = (await billableRequestsThisMonth(user.id)) + (opts.usage?.totals.billableRequests ?? 0);
    if (usedThisMonth + raw.estimatedRequests > limits.monthlyRequestLimit) {
      notes.push(monthlyLimitMessage({ needed: raw.estimatedRequests, used: usedThisMonth, limit: limits.monthlyRequestLimit }));
    } else {
      notes.push(remainingAllowanceNote(usedThisMonth, limits.monthlyRequestLimit));
    }
  }
  const estimate = toCostEstimate(provider, raw, env().COST_CONFIRM_THRESHOLD_USD, notes);
  return { input, provider, target, requestedCount, targetCount, clamped, filters, sort, limits, estimate, usedThisMonth };
}

/**
 * POST /search-jobs/estimate: validate the request and estimate its cost without creating anything
 * (and without spending billable requests).
 */
export async function estimateSearch(
  user: AppUser,
  raw: unknown,
  deps: SearchDeps = {},
): Promise<CostEstimate & { locationLabel: string; targetCount: number; kind: ResolvedSearch["kind"] }> {
  const input = parseCreateSearchInput(raw);
  const p = await prepare(user, input, deps, { mode: "estimate" });
  return { ...p.estimate, locationLabel: p.target.location.label, targetCount: p.targetCount, kind: p.target.kind };
}

async function findByIdempotencyKey(user: UserRef, key: string): Promise<SearchJob | undefined> {
  const [job] = await db()
    .select()
    .from(searchJobs)
    .where(and(eq(searchJobs.userId, user.id), eq(searchJobs.idempotencyKey, key)))
    .limit(1);
  return job;
}

/**
 * POST /search-jobs. Validates, checks quotas and cost, stores the job and queues it for the worker.
 * With an Idempotency-Key the same request returns the existing job (`created: false`).
 */
export async function createSearchJob(
  user: AppUser,
  raw: unknown,
  opts: { idempotencyKey?: string | null; ip?: string | null } = {},
  deps: SearchDeps = {},
): Promise<{ job: SearchJobDto; created: boolean }> {
  await rateLimit(`search-create:${user.id}`, 10, 60);
  const input = parseCreateSearchInput(raw);
  const key = opts.idempotencyKey ?? null;

  if (key) {
    const existing = await findByIdempotencyKey(user, key);
    if (existing) return { job: await jobDtoWithCounts(user, existing), created: false };
  }

  // Cheap checks first, so a request that will be refused never spends a geocoding request.
  const limits = await getUserSearchLimits(user.id);
  await assertJobSlots(user.id, limits);
  const provider = selectProvider(input, deps);
  const usage = new UsageRecorder(user.id, provider.id);

  try {
    const p = await prepare(user, input, deps, { mode: "create", usage, limits, provider });

    if (isBillable(provider) && limits.monthlyRequestLimit > 0 && p.usedThisMonth + p.estimate.estimatedRequests > limits.monthlyRequestLimit) {
      throw new HttpError(
        "quota_exceeded",
        monthlyLimitMessage({ needed: p.estimate.estimatedRequests, used: p.usedThisMonth, limit: limits.monthlyRequestLimit }),
        { limit: "monthly_requests", max: limits.monthlyRequestLimit, used: p.usedThisMonth, needed: p.estimate.estimatedRequests },
      );
    }
    if (p.estimate.requiresConfirmation && !input.confirm) {
      throw new HttpError("confirmation_required", confirmationMessage(p.estimate.estimatedCostUsd, p.estimate.estimatedRequests), {
        estimate: p.estimate,
      });
    }

    const firstEvent = p.clamped ? clampMessage(limits.maxResultsPerSearch, p.requestedCount) : "Search queued — waiting for a worker.";
    const job = await db().transaction(async (tx) => {
      const [inserted] = await tx
        .insert(searchJobs)
        .values({
          userId: user.id,
          kind: p.target.kind,
          query: p.target.query,
          location: p.target.location,
          sourceUrl: p.target.sourceUrl,
          provider: provider.id,
          targetCount: p.targetCount,
          enrich: input.enrich,
          filters: p.filters,
          sort: p.sort,
          fields: input.fields ?? [],
          status: "queued",
          progress: emptyProgress(),
          estimatedRequests: p.estimate.estimatedRequests,
          estimatedCostUsd: p.estimate.estimatedCostUsd,
          idempotencyKey: key,
        })
        .onConflictDoNothing({ target: [searchJobs.userId, searchJobs.idempotencyKey] })
        .returning();
      if (!inserted) return null;
      await tx.insert(jobEvents).values({
        jobId: inserted.id,
        type: p.clamped ? "target_clamped" : "created",
        message: firstEvent,
        metadata: { requested: p.requestedCount, target: p.targetCount, provider: provider.id },
      });
      return inserted;
    });

    if (!job) {
      // Same Idempotency-Key raced with a parallel request: return the job that won.
      const existing = key ? await findByIdempotencyKey(user, key) : undefined;
      if (existing) return { job: await jobDtoWithCounts(user, existing), created: false };
      throw new HttpError("conflict", "This search was already submitted.");
    }
    usage.setJobId(job.id);

    let queueJobId: string | null;
    try {
      queueJobId = await (deps.enqueue ?? enqueueJob)("search.run", { jobId: job.id }, { expireInSeconds: SEARCH_RUN_EXPIRE_SECONDS });
    } catch (e) {
      console.error("[search] enqueue failed", e);
      await db().delete(searchJobs).where(and(eq(searchJobs.id, job.id), eq(searchJobs.userId, user.id)));
      throw new HttpError("internal", QUEUE_UNAVAILABLE_MESSAGE);
    }
    const [stored] = await db()
      .update(searchJobs)
      .set({ queueJobId })
      .where(and(eq(searchJobs.id, job.id), eq(searchJobs.userId, user.id)))
      .returning();

    await audit({
      actorId: user.id,
      action: "search.create",
      resourceType: "search_job",
      resourceId: job.id,
      metadata: {
        kind: job.kind,
        provider: job.provider,
        query: job.query,
        location: job.location.label,
        targetCount: job.targetCount,
        requestedCount: p.requestedCount,
        estimatedRequests: job.estimatedRequests,
        estimatedCostUsd: p.estimate.estimatedCostUsd,
        confirmed: Boolean(input.confirm),
      },
      ip: opts.ip,
    });
    return { job: toSearchJobDto(stored ?? job, emptyCounts()), created: true };
  } finally {
    await usage.flush();
  }
}
