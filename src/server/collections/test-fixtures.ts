/**
 * Test-only fixtures for the collections module (imported by *.test.ts files only, never by app code).
 * Inserts search jobs/results directly and provides a fake provider for live-details tests.
 */
import "server-only";
import { emptyProgress, type SourceId } from "@/lib/domain";
import { db } from "../db";
import { searchJobs, searchResults, type NewSearchResult, type SearchJob, type SearchResult } from "../db/schema";
import type { BusinessProvider, ProviderPlace, UsageEvent } from "../providers/types";
import { ProviderError } from "../providers/types";

export { createTestUser, type TestUser } from "../../../tests/helpers/auth";
export { resetDb } from "../../../tests/helpers/db";
export { apiRequest, ctx } from "../../../tests/helpers/request";

export async function insertJob(
  userId: string,
  opts: { provider?: SourceId; resultsPurgedAt?: Date | null; resultsExpireAt?: Date | null } = {},
): Promise<SearchJob> {
  const [job] = await db()
    .insert(searchJobs)
    .values({
      userId,
      kind: "keyword",
      query: "hôtel",
      location: { label: "Lomé, Togo" },
      provider: opts.provider ?? "sample",
      targetCount: 20,
      status: "completed",
      progress: emptyProgress(),
      resultsPurgedAt: opts.resultsPurgedAt ?? null,
      resultsExpireAt: opts.resultsExpireAt ?? null,
    })
    .returning();
  return job!;
}

type ResultSpec = Partial<Omit<NewSearchResult, "jobId" | "userId">>;

/** A fully populated Google Places result (all provider fields present). */
export const googleSpec = (i: number, o: ResultSpec = {}): ResultSpec => ({
  source: "google_places",
  sourceRecordId: `ChIJgoogle${i}`,
  name: `Google Biz ${i}`,
  category: "Hotel",
  categories: ["hotel", "lodging"],
  phoneRaw: `+228 90 00 00 ${String(i).padStart(2, "0")}`,
  phoneE164: `+2289000000${String(i).padStart(2, "0")}`,
  phoneDigits: `2289000000${String(i).padStart(2, "0")}`,
  websiteUrl: `https://biz${i}.example/`,
  websiteHost: `biz${i}.example`,
  address: `${i} Rue du Commerce, Lomé`,
  city: "Lomé",
  region: "Maritime",
  country: "Togo",
  postalCode: "BP 100",
  lat: 6.13,
  lng: 1.22,
  rating: 4.2,
  reviewCount: 30 + i,
  mapsUrl: `https://maps.google.com/?cid=${i}`,
  businessStatus: "OPERATIONAL",
  websiteStatus: "present",
  emails: [{ email: `contact@biz${i}.example`, sourceUrl: `https://biz${i}.example/contact`, sameDomain: true }],
  primaryEmail: `contact@biz${i}.example`,
  emailOrigin: "website_crawl",
  emailStatus: "source_provided",
  phoneStatus: "source_provided",
  socials: { facebook: `https://facebook.com/biz${i}` },
  qualityStatus: "complete",
  ...o,
});

export const sampleSpec = (i: number, o: ResultSpec = {}): ResultSpec => ({
  ...googleSpec(i),
  source: "sample",
  sourceRecordId: `sample-${i}`,
  name: `Sample Biz ${i}`,
  ...o,
});

export async function insertResults(job: SearchJob, specs: ResultSpec[]): Promise<SearchResult[]> {
  const rows = await db()
    .insert(searchResults)
    .values(
      specs.map((s, i) => ({
        source: "sample" as const,
        sourceRecordId: `rec-${i}`,
        position: i + 1,
        ...s,
        jobId: job.id,
        userId: job.userId,
      })),
    )
    .returning();
  return rows.sort((a, b) => a.position - b.position);
}

/** Provider place as Google's details endpoint would return it (live values differ from the stored snapshot). */
export const livePlace = (id: string, o: Partial<ProviderPlace> = {}): ProviderPlace => ({
  sourceRecordId: id,
  name: `Live ${id}`,
  category: "Hotel",
  categories: ["hotel"],
  phoneNational: "90 12 34 56",
  phoneInternational: "+228 90 12 34 56",
  websiteUrl: `https://www.${id.toLowerCase()}.example/`,
  email: null,
  address: "Boulevard du 13 Janvier, Lomé",
  city: "Lomé",
  region: "Maritime",
  country: "Togo",
  countryCode: "TG",
  postalCode: null,
  lat: 6.1319,
  lng: 1.2228,
  rating: 4.6,
  reviewCount: 120,
  mapsUrl: `https://maps.google.com/?q=${id}`,
  businessStatus: "OPERATIONAL",
  ...o,
});

/**
 * Fake Google provider: reports one billable usage event per requested id (as the real adapter does per
 * HTTP request) and silently omits ids it has no place for. `fail` makes every call throw after its first
 * request; `failOnCall` (1-based) makes only that call throw; `hang` waits until the signal aborts.
 */
export function fakeProvider(places: ProviderPlace[], opts: { fail?: boolean; failOnCall?: number; hang?: boolean } = {}) {
  const calls: string[][] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const byId = new Map(places.map((p) => [p.sourceRecordId, p]));
  const provider: BusinessProvider = {
    id: "google_places",
    label: "Fake Google",
    isSample: false,
    geocode: async () => null,
    search: async function* () {},
    findPlace: async () => null,
    getDetails: async (ids, ctx) => {
      calls.push(ids);
      signals.push(ctx?.signal);
      const failing = opts.fail || opts.failOnCall === calls.length;
      if (opts.hang) {
        await new Promise<void>((_, reject) => {
          const abort = () => reject(new ProviderError("The request was cancelled", "unavailable"));
          if (ctx?.signal?.aborted) abort();
          ctx?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      const out = new Map<string, ProviderPlace>();
      for (const id of ids) {
        const usage: UsageEvent = { operation: "place_details", requests: 1, costUsd: 0.02, billable: true };
        await ctx?.onUsage?.(usage);
        if (failing) throw new ProviderError("Google rejected the API key", "auth", 403);
        const p = byId.get(id);
        if (p) out.set(id, p);
      }
      return out;
    },
    estimate: () => ({ estimatedRequests: 0, maxRequests: 0, estimatedCostUsd: 0, freeMonthlyRequests: null, notes: [] }),
  };
  return { provider, calls, signals };
}
