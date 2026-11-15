import "server-only";
import { and, asc, count, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES, type JobProgress, type JobStatus, type LatLng, type Rect } from "@/lib/domain";
import { db } from "../db";
import { jobEvents, searchJobs, searchResults, user, type SearchJob, type SearchResult } from "../db/schema";
import { enrichWebsite, type EnrichmentResult, type EnrichOptions } from "../enrichment";
import { env } from "../env";
import { HttpError } from "../errors";
import { isUuid } from "../http";
import { applyEnrichment, computeQuality, findProbableDuplicates, normalizePlace, sampleEnrichmentToResult, type NormalizedBusiness } from "../normalize";
import { getProvider } from "../providers/registry";
import { ProviderError, type BusinessProvider, type ProviderContext, type ProviderPlace } from "../providers/types";
import { billableRequestsThisMonth } from "../usage";
import { resultsExpiry } from "./jobs";
import { getUserSearchLimits } from "./quotas";
import { hostOfUrl, runPerHost, STOP_MESSAGES, Throttle } from "./runner-helpers";
import { UsageRecorder } from "./usage-recorder";

export type RunnerDeps = {
  provider?: BusinessProvider;
  enrich?: typeof enrichWebsite;
  now?: () => Date;
  /** How often the cancel flag is read from the database while the job runs. Default 500 ms. */
  cancelPollMs?: number;
  /** Minimum time between progress writes. Default 1000 ms (a final write always happens). */
  progressIntervalMs?: number;
  /** Extra options for each website visit (tests pass allowPrivateNetwork, resolveMx…). */
  enrichOptions?: Omit<EnrichOptions, "signal">;
  /** Parallel website visits (at most one per host). Default env CRAWL_CONCURRENCY. */
  crawlConcurrency?: number;
  /** Aborted by the worker when it shuts down or the queue gives up: the job stops and keeps its results. */
  signal?: AbortSignal;
};

const INSERT_CHUNK = 200;
const ENRICH_CHUNK = 500;
const UPDATE_CHUNK = 500;
const ENRICH_FLUSH_EVERY = 50;
export const PROBABLE_DUPLICATE_ISSUE = "probable_duplicate";

/** Error whose message is shown to the user as-is. */
class UserFacingError extends Error {}

type EnrichmentUpdate = Pick<
  NormalizedBusiness,
  "websiteStatus" | "websiteCheck" | "emails" | "primaryEmail" | "emailOrigin" | "emailStatus" | "socials" | "enrichedAt" | "qualityStatus" | "qualityIssues"
> & { id: string };

const centerOf = (r: Rect): LatLng => ({ lat: (r.low.lat + r.high.lat) / 2, lng: (r.low.lng + r.high.lng) / 2 });

const isAbortError = (e: unknown): boolean =>
  (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) ||
  (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError");

/**
 * Execute a queued search job end-to-end (search → store → enrich → finalize). Never throws for
 * job-level failures; records them on the job. Jobs that are not queued are left alone.
 */
export async function runSearchJob(jobId: string, deps: RunnerDeps = {}): Promise<void> {
  if (!isUuid(jobId)) return;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  // Claim atomically: only one worker may move a job out of "queued".
  const [job] = await db()
    .update(searchJobs)
    .set({ status: "searching", startedAt, progress: sql`${searchJobs.progress} || ${JSON.stringify({ phase: "planning" })}::jsonb` })
    .where(
      and(
        eq(searchJobs.id, jobId),
        eq(searchJobs.status, "queued"),
        // Only for accounts that are still active (disabled accounts must not keep spending).
        sql`exists (select 1 from ${user} where ${user.id} = ${searchJobs.userId} and ${user.status} = 'active')`,
      ),
    )
    .returning();
  if (!job) {
    await db()
      .update(searchJobs)
      .set({ status: "cancelled", stopReason: "Cancelled because the account is not active.", finishedAt: now() })
      .where(
        and(
          eq(searchJobs.id, jobId),
          eq(searchJobs.status, "queued"),
          sql`not exists (select 1 from ${user} where ${user.id} = ${searchJobs.userId} and ${user.status} = 'active')`,
        ),
      );
    return;
  }
  await new SearchRun(job, deps, now).execute();
}

class SearchRun {
  private readonly controller = new AbortController();
  private readonly usage: UsageRecorder;
  private readonly progressThrottle: Throttle;
  private provider!: BusinessProvider;
  private cancelTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  // State
  private status: JobStatus = "searching";
  private phase: JobProgress["phase"] = "planning";
  private found = 0;
  private inserted = 0;
  private nextPosition = 0;
  private tilesDone = 0;
  private tilesTotal = 0;
  private tilesAnnounced = 0;
  private enriched = 0;
  private enrichTotal = 0;
  private enrichFailures = 0;
  private emailsFound = 0;
  private readonly seen = new Set<string>();
  /** Sample places keep their pre-computed enrichment until the enrichment phase. */
  private readonly samplePlaces = new Map<string, ProviderPlace>();

  private maxRequests = 0;
  private monthlyLimit = 0;
  private monthlyCapped = false;
  private searchRequests = 0;
  private exhausted = false;
  private targetReached = false;
  private noteReceived = false;
  private placeNotFound = false;
  private noBudget = false;
  private providerError: ProviderError | null = null;
  private cancelled = false;
  private interrupted = false;
  private deleted = false;
  private finalized = false;

  constructor(
    private readonly job: SearchJob,
    private readonly deps: RunnerDeps,
    private readonly now: () => Date,
  ) {
    this.usage = new UsageRecorder(job.userId, job.provider, job.id);
    this.progressThrottle = new Throttle(deps.progressIntervalMs ?? 1000);
  }

  private get signal() {
    return this.controller.signal;
  }

  private get stopping() {
    return this.cancelled || this.deleted || this.interrupted;
  }

  async execute(): Promise<void> {
    try {
      await this.event("started", `Search started for “${this.job.query}” in ${this.job.location.label}.`);
      this.provider = this.deps.provider ?? this.providerFromRegistry();
      this.watchExternalSignal();
      this.startCancelWatch();
      await this.searchPhase();
      if (!this.stopping && this.job.enrich && this.inserted > 0) await this.enrichPhase();
      if (!this.deleted && this.inserted > 1) await this.duplicatePass();
      if (!this.deleted) await this.finalize();
    } catch (e) {
      await this.fail(e);
    } finally {
      this.stopCancelWatch();
      this.deps.signal?.removeEventListener("abort", this.onExternalAbort);
      await this.usage.flush().catch((e) => console.error("[search] usage flush failed", e));
      if (!this.finalized && !this.deleted) await this.markFailedIfActive(STOP_MESSAGES.unexpected()).catch(() => undefined);
    }
  }

  private providerFromRegistry(): BusinessProvider {
    try {
      return getProvider(this.job.provider);
    } catch (e) {
      if (e instanceof HttpError) throw new UserFacingError(STOP_MESSAGES.providerUnavailable());
      throw e;
    }
  }

  private readonly onExternalAbort = () => {
    if (this.signal.aborted) return;
    this.interrupted = true;
    this.controller.abort(new DOMException("The worker is shutting down", "AbortError"));
  };

  private watchExternalSignal() {
    const s = this.deps.signal;
    if (!s) return;
    if (s.aborted) this.onExternalAbort();
    else s.addEventListener("abort", this.onExternalAbort, { once: true });
  }

  /* ───────────────────────────── search ───────────────────────────── */

  private providerContext(): ProviderContext {
    return {
      signal: this.signal,
      onUsage: this.usage.onUsage,
      onNote: (message) => {
        this.noteReceived = true;
        void this.event("note", message);
      },
    };
  }

  private async searchPhase(): Promise<void> {
    this.phase = "searching";
    await this.writeProgress(true);

    if (this.job.kind === "maps_place_link") return this.placePhase();

    const area = this.job.location.viewport;
    if (!area) throw new UserFacingError(STOP_MESSAGES.noArea());
    const center = this.job.location.center ?? centerOf(area);

    const estimate = this.provider.estimate(this.job.targetCount);
    this.maxRequests = Math.max(0, Math.floor(estimate.maxRequests));
    if (!this.provider.isSample) {
      const limits = await getUserSearchLimits(this.job.userId);
      this.monthlyLimit = limits.monthlyRequestLimit;
      if (this.monthlyLimit > 0) {
        const remaining = Math.max(0, this.monthlyLimit - (await billableRequestsThisMonth(this.job.userId)));
        if (remaining < this.maxRequests) {
          this.maxRequests = remaining;
          this.monthlyCapped = true;
        }
      }
    }
    if (this.maxRequests <= 0) {
      this.noBudget = true;
      return;
    }

    const plan = { query: this.job.query, area, center, targetCount: this.job.targetCount, maxRequests: this.maxRequests };
    const before = this.usage.totals.requests;
    try {
      for await (const page of this.provider.search(plan, this.providerContext())) {
        this.tilesDone = page.tilesDone;
        this.tilesTotal = Math.max(page.tilesTotal, page.tilesDone);
        if (page.exhausted) this.exhausted = true;
        await this.storePlaces(page.places ?? []);
        await this.usage.flush();
        await this.announceTiles();
        await this.writeProgress();
        if (this.inserted >= this.job.targetCount) {
          this.targetReached = true;
          break;
        }
        if (this.stopping) break;
      }
    } catch (e) {
      if (this.signal.aborted && (isAbortError(e) || this.stopping)) {
        // Stopped by the user (or the job was deleted): keep what we have.
      } else if (e instanceof ProviderError) {
        this.providerError = e;
        await this.event("error", e.message, { kind: e.kind, status: e.status ?? null });
      } else throw e;
    } finally {
      this.searchRequests = this.usage.totals.requests - before;
    }
  }

  private async placePhase(): Promise<void> {
    const before = this.usage.totals.requests;
    try {
      const place = await this.provider.findPlace({ name: this.job.query, center: this.job.location.center }, this.providerContext());
      if (place) {
        await this.storePlaces([place]);
        this.targetReached = this.inserted >= 1;
      } else this.placeNotFound = true;
    } catch (e) {
      if (this.signal.aborted && (isAbortError(e) || this.stopping)) return;
      if (e instanceof ProviderError) {
        this.providerError = e;
        await this.event("error", e.message, { kind: e.kind, status: e.status ?? null });
      } else throw e;
    } finally {
      this.searchRequests = this.usage.totals.requests - before;
      await this.usage.flush();
      await this.writeProgress();
    }
  }

  private async announceTiles() {
    if (this.tilesTotal > 1 && this.tilesTotal >= Math.max(2, Math.ceil(this.tilesAnnounced * 1.5))) {
      const first = this.tilesAnnounced === 0;
      this.tilesAnnounced = this.tilesTotal;
      await this.event(
        "tiles",
        first
          ? `Splitting the map into ${this.tilesTotal} smaller areas to find more results.`
          : `Dense area: now searching ${this.tilesTotal} smaller map areas.`,
        { tilesDone: this.tilesDone, tilesTotal: this.tilesTotal },
      );
    }
  }

  /** De-duplicate by provider ID, normalize and insert (positions keep increasing). Trims beyond the target. */
  private async storePlaces(places: ProviderPlace[]): Promise<void> {
    this.found += places.length;
    const rows: (NormalizedBusiness & { jobId: string; userId: string; position: number })[] = [];
    const retrievedAt = this.now();
    for (const place of places) {
      if (this.inserted + rows.length >= this.job.targetCount) break;
      const id = place?.sourceRecordId;
      if (!id || this.seen.has(id)) continue;
      this.seen.add(id);
      const rec = normalizePlace(place, { source: this.job.provider, retrievedAt });
      rows.push({ ...rec, jobId: this.job.id, userId: this.job.userId, position: this.nextPosition++ });
      if (place.sampleEnrichment && this.job.enrich && rec.websiteUrl) this.samplePlaces.set(id, place);
    }
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const ins = await db()
        .insert(searchResults)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoNothing({ target: [searchResults.jobId, searchResults.source, searchResults.sourceRecordId] })
        .returning({ id: searchResults.id });
      this.inserted += ins.length;
    }
  }

  /* ───────────────────────────── enrichment ───────────────────────────── */

  private async enrichPhase(): Promise<void> {
    const scope = and(eq(searchResults.jobId, this.job.id), eq(searchResults.userId, this.job.userId), isNotNull(searchResults.websiteUrl));
    const [c] = await db().select({ n: count() }).from(searchResults).where(scope);
    this.enrichTotal = Number(c?.n ?? 0);
    if (this.enrichTotal === 0) return;

    this.status = "enriching";
    this.phase = "enriching";
    await db()
      .update(searchJobs)
      .set({ status: "enriching" })
      .where(and(eq(searchJobs.id, this.job.id), inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])));
    await this.writeProgress(true);
    await this.event(
      "enrichment_started",
      this.provider.isSample
        ? `Checking ${this.enrichTotal} sample websites for emails and social links (no real sites are visited).`
        : `Visiting ${this.enrichTotal} business websites to find published emails and social links.`,
    );

    const enrich = this.deps.enrich ?? enrichWebsite;
    const concurrency = Math.max(1, Math.floor(this.deps.crawlConcurrency ?? env().CRAWL_CONCURRENCY) || 1);
    let pending: EnrichmentUpdate[] = [];
    const flush = async () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      await this.writeEnrichment(batch);
    };
    const record = async (row: SearchResult, e: EnrichmentResult) => {
      const changes = applyEnrichment(row, e, this.now());
      const merged = { ...row, ...changes };
      if (merged.primaryEmail) this.emailsFound += 1;
      pending.push({
        id: row.id,
        websiteStatus: merged.websiteStatus,
        websiteCheck: merged.websiteCheck,
        emails: merged.emails,
        primaryEmail: merged.primaryEmail,
        emailOrigin: merged.emailOrigin,
        emailStatus: merged.emailStatus,
        socials: merged.socials,
        enrichedAt: merged.enrichedAt,
        qualityStatus: merged.qualityStatus,
        qualityIssues: merged.qualityIssues,
      });
      if (pending.length >= ENRICH_FLUSH_EVERY) await flush();
    };

    let lastPosition = -1;
    for (;;) {
      if (this.stopping) break;
      const chunk = await db()
        .select()
        .from(searchResults)
        .where(and(scope, gt(searchResults.position, lastPosition)))
        .orderBy(asc(searchResults.position))
        .limit(ENRICH_CHUNK);
      if (chunk.length === 0) break;
      lastPosition = chunk[chunk.length - 1]!.position;

      const toCrawl: SearchResult[] = [];
      for (const row of chunk) {
        const place = row.source === "sample" ? this.samplePlaces.get(row.sourceRecordId) : undefined;
        if (row.source === "sample" || this.provider.isSample) {
          // Sample data never touches the network: use the pre-computed enrichment.
          const e = place ? sampleEnrichmentToResult(place, this.now()) : null;
          if (e) await record(row, e);
          this.enriched += 1;
        } else toCrawl.push(row);
      }
      await flush();
      await this.writeProgress();

      await runPerHost(toCrawl, { concurrency, hostOf: (r) => r.websiteHost ?? hostOfUrl(r.websiteUrl), signal: this.signal }, async (row) => {
        if (this.signal.aborted || !row.websiteUrl) return;
        let e: EnrichmentResult;
        try {
          e = await enrich(row.websiteUrl, { ...this.deps.enrichOptions, signal: this.signal });
        } catch (err) {
          if (this.signal.aborted) return;
          this.enrichFailures += 1;
          this.enriched += 1;
          console.error("[search] website check failed", row.websiteHost, err);
          return;
        }
        // A visit interrupted by "Stop" is not kept (it would only say "skipped").
        if (this.signal.aborted) return;
        await record(row, e);
        this.enriched += 1;
        await this.writeProgress();
      });
      await flush();
      await this.writeProgress();
    }
    await flush();
    await this.writeProgress(true);

    const failures = this.enrichFailures ? ` ${this.enrichFailures} could not be checked because of an internal error.` : "";
    await this.event(
      "enrichment_done",
      this.stopping
        ? `Website checks stopped after ${this.enriched} of ${this.enrichTotal}.${failures}`
        : `Checked ${this.enrichTotal} websites: ${this.emailsFound} businesses publish an email address.${failures}`,
      { enriched: this.enriched, enrichTotal: this.enrichTotal, emailsFound: this.emailsFound, failures: this.enrichFailures },
    );
  }

  /** Bulk update of the enrichment columns (one parameterized statement per chunk). */
  private async writeEnrichment(updates: EnrichmentUpdate[]): Promise<void> {
    for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
      const payload = JSON.stringify(
        updates.slice(i, i + UPDATE_CHUNK).map((u) => ({
          id: u.id,
          website_status: u.websiteStatus ?? "unknown",
          website_check: u.websiteCheck ?? null,
          emails: u.emails ?? [],
          primary_email: u.primaryEmail ?? null,
          email_origin: u.emailOrigin ?? null,
          email_status: u.emailStatus ?? "unknown",
          socials: u.socials ?? {},
          enriched_at: u.enrichedAt ? new Date(u.enrichedAt).toISOString() : null,
          quality_status: u.qualityStatus ?? "incomplete",
          quality_issues: u.qualityIssues ?? [],
        })),
      );
      await db().execute(sql`
        update search_results as sr set
          website_status = v.website_status,
          website_check = v.website_check,
          emails = v.emails,
          primary_email = v.primary_email,
          email_origin = v.email_origin,
          email_status = v.email_status,
          socials = v.socials,
          enriched_at = v.enriched_at,
          quality_status = v.quality_status,
          quality_issues = v.quality_issues,
          updated_at = now()
        from jsonb_to_recordset(${payload}::jsonb) as v(
          id uuid, website_status text, website_check jsonb, emails jsonb, primary_email text, email_origin text,
          email_status text, socials jsonb, enriched_at timestamptz, quality_status text, quality_issues text[]
        )
        where sr.id = v.id and sr.job_id = ${this.job.id} and sr.user_id = ${this.job.userId}
      `);
    }
  }

  /* ───────────────────────────── duplicates ───────────────────────────── */

  private async duplicatePass(): Promise<void> {
    const rows = await db()
      .select()
      .from(searchResults)
      .where(and(eq(searchResults.jobId, this.job.id), eq(searchResults.userId, this.job.userId)))
      .orderBy(asc(searchResults.position));
    const dupes = findProbableDuplicates(
      rows.map((r) => ({ id: r.id, name: r.name, phoneE164: r.phoneE164, address: r.address, websiteHost: r.websiteHost, lat: r.lat, lng: r.lng })),
    );
    if (dupes.size === 0) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const updates: { id: string; duplicate_of_id: string; quality_status: string; quality_issues: string[] }[] = [];
    for (const [dupId, originalId] of dupes) {
      const row = byId.get(dupId);
      if (!row || dupId === originalId) continue;
      const q = computeQuality({ ...row, duplicateOfId: originalId });
      updates.push({
        id: dupId,
        duplicate_of_id: originalId,
        quality_status: q.qualityStatus,
        quality_issues: [...new Set([...q.qualityIssues, PROBABLE_DUPLICATE_ISSUE])],
      });
    }
    for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
      const payload = JSON.stringify(updates.slice(i, i + UPDATE_CHUNK));
      await db().execute(sql`
        update search_results as sr set
          duplicate_of_id = v.duplicate_of_id,
          quality_status = v.quality_status,
          quality_issues = v.quality_issues,
          updated_at = now()
        from jsonb_to_recordset(${payload}::jsonb) as v(id uuid, duplicate_of_id uuid, quality_status text, quality_issues text[])
        where sr.id = v.id and sr.job_id = ${this.job.id} and sr.user_id = ${this.job.userId}
      `);
    }
    await this.event("duplicates", `Flagged ${updates.length} probable duplicate${updates.length === 1 ? "" : "s"} for review (nothing was merged).`, {
      count: updates.length,
    });
  }

  /* ───────────────────────────── finalize ───────────────────────────── */

  private outcome(): { status: JobStatus; stopReason: string | null; error: string | null } {
    const n = this.inserted;
    const isSample = this.provider.isSample;
    if (this.cancelled) return { status: "cancelled", stopReason: STOP_MESSAGES.cancelled(n), error: null };
    if (this.interrupted) {
      const msg = STOP_MESSAGES.workerStopped();
      return n > 0 ? { status: "partial", stopReason: msg, error: msg } : { status: "failed", stopReason: null, error: msg };
    }
    if (this.providerError) {
      const msg = this.providerError.message;
      return n > 0
        ? { status: "partial", stopReason: STOP_MESSAGES.providerErrorPartial(n, msg), error: msg }
        : { status: "failed", stopReason: null, error: msg };
    }
    if (this.job.kind === "maps_place_link") {
      return this.placeNotFound || n === 0
        ? { status: "failed", stopReason: null, error: STOP_MESSAGES.placeNotFound() }
        : { status: "completed", stopReason: STOP_MESSAGES.placeFound(), error: null };
    }
    if (this.noBudget) {
      const msg = this.monthlyCapped ? STOP_MESSAGES.monthlyExhaustedBeforeStart(this.monthlyLimit) : STOP_MESSAGES.budget(0, 0);
      return { status: "failed", stopReason: null, error: msg };
    }
    if (this.targetReached || n >= this.job.targetCount) return { status: "completed", stopReason: STOP_MESSAGES.targetReached(n), error: null };
    const budgetHit = !this.exhausted && (this.searchRequests >= this.maxRequests || this.noteReceived);
    if (budgetHit) {
      const msg = this.monthlyCapped ? STOP_MESSAGES.monthly(n, this.monthlyLimit) : STOP_MESSAGES.budget(n, this.searchRequests);
      return n > 0 ? { status: "partial", stopReason: msg, error: null } : { status: "failed", stopReason: null, error: msg };
    }
    return {
      status: "completed",
      stopReason: n > 0 ? STOP_MESSAGES.exhausted(n, isSample) : STOP_MESSAGES.noResults(this.job.query),
      error: null,
    };
  }

  private async finalize(): Promise<void> {
    const o = this.outcome();
    await this.usage.flush();
    const finishedAt = this.now();
    this.phase = "done";
    this.status = o.status;
    const [done] = await db()
      .update(searchJobs)
      .set({
        status: o.status,
        stopReason: o.stopReason,
        error: o.error,
        finishedAt,
        resultsExpireAt: resultsExpiry(this.job, finishedAt),
        progress: this.progressSnapshot(o.stopReason ?? o.error ?? undefined),
        actualRequests: this.usage.totals.requests,
      })
      .where(and(eq(searchJobs.id, this.job.id), inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])))
      .returning({ id: searchJobs.id });
    this.finalized = true;
    if (done) {
      await this.event(o.status === "failed" ? "failed" : "stopped", o.stopReason ?? o.error ?? `Search ${o.status}.`, {
        status: o.status,
        results: this.inserted,
        requests: this.usage.totals.requests,
        billableRequests: this.usage.totals.billableRequests,
        costUsd: Math.round(this.usage.totals.costUsd * 10_000) / 10_000,
      });
    }
  }

  private async fail(e: unknown): Promise<void> {
    if (!(await this.jobExists())) {
      this.deleted = true;
      return;
    }
    const message = e instanceof UserFacingError || e instanceof HttpError || e instanceof ProviderError ? e.message : STOP_MESSAGES.unexpected();
    if (!(e instanceof UserFacingError || e instanceof HttpError || e instanceof ProviderError)) console.error("[search] job failed", this.job.id, e);
    const status: JobStatus = this.cancelled ? "cancelled" : this.inserted > 0 ? "partial" : "failed";
    const stopReason = status === "cancelled" ? STOP_MESSAGES.cancelled(this.inserted) : status === "partial" ? STOP_MESSAGES.providerErrorPartial(this.inserted, message) : null;
    try {
      await this.usage.flush();
      const finishedAt = this.now();
      this.phase = "done";
      await db()
        .update(searchJobs)
        .set({
          status,
          stopReason,
          error: status === "cancelled" ? null : message,
          finishedAt,
          resultsExpireAt: resultsExpiry(this.job, finishedAt),
          progress: this.progressSnapshot(stopReason ?? message),
          actualRequests: this.usage.totals.requests,
        })
        .where(and(eq(searchJobs.id, this.job.id), inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])));
      this.finalized = true;
      await this.event("failed", message);
    } catch (err) {
      console.error("[search] could not record job failure", this.job.id, err);
    }
  }

  private async markFailedIfActive(message: string) {
    const finishedAt = this.now();
    await db()
      .update(searchJobs)
      .set({
        status: this.inserted > 0 ? "partial" : "failed",
        error: message,
        stopReason: this.inserted > 0 ? STOP_MESSAGES.providerErrorPartial(this.inserted, message) : null,
        finishedAt,
        resultsExpireAt: resultsExpiry(this.job, finishedAt),
        progress: this.progressSnapshot(message),
      })
      .where(and(eq(searchJobs.id, this.job.id), inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])));
  }

  /* ───────────────────────────── plumbing ───────────────────────────── */

  private progressSnapshot(message?: string): JobProgress {
    return {
      phase: this.phase,
      found: this.found,
      unique: this.inserted,
      requests: this.usage.totals.requests,
      tilesDone: this.tilesDone,
      tilesTotal: this.tilesTotal,
      enriched: this.enriched,
      enrichTotal: this.enrichTotal,
      ...(message ? { message } : {}),
    };
  }

  /** Throttled to one write per interval unless forced. */
  private async writeProgress(force = false): Promise<void> {
    if (!force && !this.progressThrottle.due()) return;
    if (force) this.progressThrottle.due();
    await db()
      .update(searchJobs)
      .set({ progress: this.progressSnapshot(), actualRequests: this.usage.totals.requests })
      .where(and(eq(searchJobs.id, this.job.id), inArray(searchJobs.status, [...ACTIVE_JOB_STATUSES])));
  }

  private async event(type: string, message: string, metadata: Record<string, unknown> = {}): Promise<void> {
    try {
      await db().insert(jobEvents).values({ jobId: this.job.id, type, message, metadata });
    } catch (e) {
      // The job may have been deleted meanwhile; events are informational only.
      if (!this.deleted) console.warn("[search] could not record job event", type, e instanceof Error ? e.message : e);
    }
  }

  private async jobExists(): Promise<boolean> {
    try {
      const [row] = await db().select({ id: searchJobs.id }).from(searchJobs).where(eq(searchJobs.id, this.job.id)).limit(1);
      return Boolean(row);
    } catch {
      return true;
    }
  }

  private startCancelWatch() {
    const every = Math.max(10, this.deps.cancelPollMs ?? 500);
    this.cancelTimer = setInterval(() => void this.pollCancel(), every);
    this.cancelTimer.unref?.();
  }

  private stopCancelWatch() {
    if (this.cancelTimer) clearInterval(this.cancelTimer);
    this.cancelTimer = null;
  }

  private async pollCancel(): Promise<void> {
    if (this.polling || this.signal.aborted) return;
    this.polling = true;
    try {
      const [row] = await db()
        .select({ cancelRequested: searchJobs.cancelRequested })
        .from(searchJobs)
        .where(eq(searchJobs.id, this.job.id))
        .limit(1);
      if (!row) {
        this.deleted = true;
        this.controller.abort(new DOMException("The search was deleted", "AbortError"));
      } else if (row.cancelRequested) {
        this.cancelled = true;
        this.controller.abort(new DOMException("The search was stopped", "AbortError"));
        void this.event("cancelling", "Stopping — keeping the results found so far.");
      }
    } catch (e) {
      console.warn("[search] cancel check failed", e instanceof Error ? e.message : e);
    } finally {
      this.polling = false;
    }
  }
}
