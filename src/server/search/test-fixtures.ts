/**
 * Test-only fixtures for the search module (imported by *.test.ts files only, never by app code).
 */
import { emptyProgress, type JobStatus, type SourceId } from "@/lib/domain";
import { db } from "../db";
import { searchJobs, searchResults, type NewSearchResult, type SearchJob, type SearchResult } from "../db/schema";

type NewSearchJob = typeof searchJobs.$inferInsert;
import type { EnrichmentResult } from "../enrichment";
import type {
  BusinessProvider,
  CostEstimateResult,
  GeocodeResult,
  ProviderContext,
  ProviderPlace,
  SearchPage,
  SearchPlan,
} from "../providers/types";

export const LOME_VIEWPORT = { low: { lat: 6.1, lng: 1.15 }, high: { lat: 6.2, lng: 1.3 } };
export const LOME_CENTER = { lat: 6.1375, lng: 1.2123 };

export function fakePlace(i: number, o: Partial<ProviderPlace> = {}): ProviderPlace {
  const n = String(i).padStart(3, "0");
  return {
    sourceRecordId: `place-${n}`,
    name: `Hôtel Test ${n}`,
    category: "Hotel",
    categories: ["hotel", "lodging"],
    phoneNational: null,
    phoneInternational: `+228 90 12 3${n.slice(0, 1)} ${n.slice(1)}`,
    websiteUrl: null,
    email: null,
    address: `${i} Rue du Commerce, Lomé`,
    city: "Lomé",
    region: "Maritime",
    country: "Togo",
    countryCode: "TG",
    postalCode: null,
    lat: 6.13 + i * 0.001,
    lng: 1.21 + i * 0.001,
    rating: 4,
    reviewCount: 10 + i,
    mapsUrl: `https://maps.google.com/?cid=${i}`,
    businessStatus: "OPERATIONAL",
    ...o,
  };
}

export type ScriptContext = { plan: SearchPlan; ctx: ProviderContext; requests: () => number; bill: (n?: number) => Promise<void> };

/**
 * A scripted BusinessProvider. `search` runs `script`, which yields pages; every page yielded is
 * counted as one billable (or free, for sample) text_search request via ctx.onUsage.
 */
export function fakeProvider(opts: {
  id?: SourceId;
  isSample?: boolean;
  script?: (s: ScriptContext) => AsyncGenerator<SearchPage>;
  pages?: SearchPage[];
  estimate?: Partial<CostEstimateResult>;
  geocode?: (location: string) => GeocodeResult | null;
  findPlace?: (input: { name: string }) => ProviderPlace | null;
  costPerRequest?: number;
}): BusinessProvider & { plans: SearchPlan[] } {
  const isSample = opts.isSample ?? false;
  const cost = opts.costPerRequest ?? (isSample ? 0 : 0.035);
  const plans: SearchPlan[] = [];
  return {
    id: opts.id ?? (isSample ? "sample" : "google_places"),
    label: isSample ? "Sample data" : "Fake Google",
    isSample,
    plans,
    async geocode(location, ctx) {
      await ctx?.onUsage?.({ operation: "geocode", requests: 1, costUsd: cost, billable: !isSample });
      return opts.geocode ? opts.geocode(location) : { label: location, center: LOME_CENTER, viewport: LOME_VIEWPORT };
    },
    search(plan, ctx = {}) {
      plans.push(plan);
      let requests = 0;
      const bill = async (n = 1) => {
        requests += n;
        await ctx.onUsage?.({ operation: "text_search", requests: n, costUsd: cost * n, billable: !isSample });
      };
      const s: ScriptContext = { plan, ctx, requests: () => requests, bill };
      if (opts.script) return opts.script(s);
      const pages = opts.pages ?? [];
      return (async function* () {
        for (const p of pages) {
          if (ctx.signal?.aborted) return;
          if (requests >= plan.maxRequests) {
            ctx.onNote?.(`Request budget reached (${requests} requests)`);
            return;
          }
          await bill();
          yield p;
        }
      })();
    },
    async findPlace(input, ctx) {
      await ctx?.onUsage?.({ operation: "find_place", requests: 1, costUsd: cost, billable: !isSample });
      return opts.findPlace ? opts.findPlace(input) : null;
    },
    async getDetails() {
      return new Map();
    },
    estimate(target) {
      const pages = Math.ceil(target / 20);
      return {
        estimatedRequests: pages,
        maxRequests: Math.ceil(pages * 1.5) + 5,
        estimatedCostUsd: pages * cost,
        freeMonthlyRequests: null,
        notes: [],
        ...opts.estimate,
      };
    },
  };
}

export const page = (places: ProviderPlace[], o: Partial<SearchPage> = {}): SearchPage => ({ places, tilesDone: 1, tilesTotal: 1, ...o });

export function enrichmentResult(o: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    websiteStatus: "present",
    websiteCheck: { status: "ok", httpStatus: 200, https: true, pagesVisited: 1, checkedAt: new Date().toISOString() },
    emails: [],
    socials: {},
    phones: [],
    mx: {},
    ...o,
  };
}

export async function insertJob(userId: string, o: Partial<NewSearchJob> & { status?: JobStatus } = {}): Promise<SearchJob> {
  const [job] = await db()
    .insert(searchJobs)
    .values({
      userId,
      kind: "keyword",
      query: "hôtel",
      location: { label: "Lomé, Togo", center: LOME_CENTER, viewport: LOME_VIEWPORT },
      provider: "sample",
      targetCount: 20,
      status: "queued",
      progress: emptyProgress(),
      ...o,
    })
    .returning();
  return job!;
}

type ResultSpec = Partial<Omit<NewSearchResult, "jobId" | "userId">>;

export async function insertResults(job: SearchJob, specs: ResultSpec[]): Promise<SearchResult[]> {
  if (specs.length === 0) return [];
  return db()
    .insert(searchResults)
    .values(
      specs.map((s, i) => ({
        jobId: job.id,
        userId: job.userId,
        position: i,
        source: job.provider,
        sourceRecordId: `rec-${i}`,
        ...s,
      })),
    )
    .returning();
}
