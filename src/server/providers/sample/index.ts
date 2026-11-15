import "server-only";
/**
 * Sample data provider: deterministic, offline, fictional businesses that look realistic for the
 * searched location. Used when no Google Maps key is configured, in tests and in demos. Never
 * touches the network; websites, emails and social links all live under the reserved `.example` TLD.
 */
import type { LatLng } from "@/lib/domain";
import { approxDistanceMeters } from "@/server/normalize/geo";
import { nameSimilarity } from "@/server/normalize/text";
import type { BusinessProvider, CostEstimateResult, ProviderContext, ProviderPlace, SearchPage, SearchPlan } from "../types";
import { CATEGORIES, resolveCategory, type CategoryDef } from "./catalog";
import { geocodeLocation } from "./geocode";
import {
  CELL_DEG,
  cellOf,
  cellRange,
  cellsInRange,
  decodeId,
  expectedPerCell,
  generateCell,
  generatePlace,
  inArea,
  normalizeArea,
  spiralCells,
} from "./world";

export const SAMPLE_PAGE_SIZE = 20;
export const SAMPLE_NOTE = "Sample data mode — no real businesses, no cost";

export type SampleProviderOptions = {
  /** Clock for websiteCheck.checkedAt (tests). */
  now?: () => Date;
  /**
   * Artificial latency per result page in ms. Default: 40–120 ms, and 0 when
   * process.env.APP_ENV === "test".
   */
  pageDelayMs?: () => number;
};

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Default artificial latency per page: 40–120 ms, none when APP_ENV is "test". */
export function defaultSamplePageDelayMs(): number {
  return process.env.APP_ENV === "test" ? 0 : 40 + Math.floor(Math.random() * 81);
}

/** Cost estimate for sample mode: one "request" per page of 20, never billed. */
export function sampleEstimate(targetCount: number): CostEstimateResult {
  const target = Math.max(0, Math.floor(Number.isFinite(targetCount) ? targetCount : 0));
  const estimatedRequests = Math.ceil(target / SAMPLE_PAGE_SIZE);
  return {
    estimatedRequests,
    maxRequests: estimatedRequests === 0 ? 0 : Math.ceil(estimatedRequests * 1.5) + 5,
    estimatedCostUsd: 0,
    freeMonthlyRequests: null,
    notes: [SAMPLE_NOTE],
  };
}

/**
 * Stream pages of ≤ 20 places for the plan's query and area, visiting grid cells ("tiles") outward
 * from the centre. Stops at targetCount, maxRequests, abort, or when the area is exhausted.
 */
async function* searchPages(plan: SearchPlan, ctx: ProviderContext, opts: Required<SampleProviderOptions>): AsyncGenerator<SearchPage> {
  const target = Math.max(0, Math.floor(Number.isFinite(plan.targetCount) ? plan.targetCount : 0));
  const maxRequests = Math.max(0, Math.floor(Number.isFinite(plan.maxRequests) ? plan.maxRequests : 0));
  if (target === 0) return;
  if (maxRequests === 0) {
    ctx.onNote?.("Request budget reached before the search could start");
    return;
  }

  const def = resolveCategory(plan.query);
  const area = normalizeArea(plan.area, plan.center);
  const range = cellRange(area);
  const totalCells = cellsInRange(range);
  const center: LatLng = {
    lat: Math.min(area.high.lat, Math.max(area.low.lat, Number.isFinite(plan.center?.lat) ? plan.center.lat : (area.low.lat + area.high.lat) / 2)),
    lng: Math.min(area.high.lng, Math.max(area.low.lng, Number.isFinite(plan.center?.lng) ? plan.center.lng : (area.low.lng + area.high.lng) / 2)),
  };
  const start = cellOf(center.lat, center.lng);
  const cells = spiralCells(range, start.cx, start.cy);
  const now = opts.now();

  let buffer: ProviderPlace[] = [];
  let cellsDone = 0;
  let cellsLeft = true;
  let collected = 0;
  let tilesTotal = Math.max(1, Math.min(totalCells, Math.ceil(target / Math.max(0.25, expectedPerCell(center.lat, center.lng)))));

  /** Visit cells until the buffer holds `n` places or the area is exhausted. */
  const fill = (n: number) => {
    while (buffer.length < n && cellsLeft) {
      const next = cells.next();
      if (next.done) {
        cellsLeft = false;
        break;
      }
      const [cx, cy] = next.value;
      for (const p of generateCell(def, cx, cy, now)) {
        if (inArea(area, p)) {
          buffer.push(p);
          collected += 1;
        }
      }
      cellsDone += 1;
      const perCell = Math.max(0.25, collected / cellsDone);
      const remaining = Math.max(0, target - collected);
      tilesTotal = Math.min(totalCells, Math.max(tilesTotal, cellsDone + Math.ceil(remaining / perCell)));
    }
  };

  let produced = 0;
  let requests = 0;
  for (;;) {
    if (ctx.signal?.aborted) return;
    if (requests >= maxRequests) {
      ctx.onNote?.(`Request budget reached (${requests} requests)`);
      return;
    }
    const want = Math.min(SAMPLE_PAGE_SIZE, target - produced);
    fill(want);
    await sleep(opts.pageDelayMs(), ctx.signal);
    if (ctx.signal?.aborted) return;

    const page = buffer.slice(0, want);
    buffer = buffer.slice(want);
    requests += 1;
    await ctx.onUsage?.({ operation: "text_search", requests: 1, costUsd: 0, billable: false });
    produced += page.length;

    fill(1);
    const exhausted = buffer.length === 0 && !cellsLeft;
    const done = exhausted || produced >= target;
    // Once finished every visited tile is the whole plan; until then report the planned total.
    if (done) tilesTotal = cellsDone;
    yield { places: page, tilesDone: cellsDone, tilesTotal: Math.max(tilesTotal, cellsDone), ...(exhausted ? { exhausted: true } : {}) };
    if (done) return;
  }
}

/** Look up records by id; unknown or malformed ids are simply absent from the result. */
function detailsFor(ids: string[], now: Date): Map<string, ProviderPlace> {
  const out = new Map<string, ProviderPlace>();
  for (const id of new Set(ids)) {
    const d = decodeId(id);
    if (!d) continue;
    out.set(id, generatePlace(d.def, d.cx, d.cy, d.slot, now));
  }
  return out;
}

/** Name similarity at which a candidate is taken as the business the link points to. */
const SAME_NAME = 0.9;

/**
 * Best sample business for a Maps place link: the same name nearby (any category), else the closest
 * business of the category the name suggests. Searches the 3 × 3 cells around the pin (≥ 550 m).
 */
function findPlaceNear(name: string, center: LatLng, now: Date): ProviderPlace | null {
  const preferred = resolveCategory(name);
  const preferredKnown = CATEGORIES.some((c) => c.key === preferred.key);
  const { cx, cy } = cellOf(center.lat, center.lng);

  const bestAmong = (defs: readonly CategoryDef[]) => {
    let best: { p: ProviderPlace; sim: number; score: number } | null = null;
    for (const def of defs) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const p of generateCell(def, cx + dx, cy + dy, now)) {
            if (p.lat === null || p.lng === null || !p.name) continue;
            const sim = nameSimilarity(name, p.name);
            const dist = approxDistanceMeters(center, { lat: p.lat, lng: p.lng });
            const score = sim - dist / 2000 + (def.key === preferred.key ? 0.05 : 0);
            if (!best || score > best.score || (score === best.score && p.sourceRecordId < best.p.sourceRecordId)) best = { p, sim, score };
          }
        }
      }
    }
    return best;
  };

  if (preferredKnown) {
    // Same name nearby, else the nearest fictional business of the kind the name suggests (a hotel
    // link gives a hotel). The real name is never attached to generated data.
    const own = bestAmong([preferred]);
    if (own) return own.p;
  }
  const any = bestAmong(preferredKnown ? CATEGORIES : [preferred, ...CATEGORIES]);
  return any?.p ?? null;
}

export function createSampleProvider(options: SampleProviderOptions = {}): BusinessProvider {
  const opts: Required<SampleProviderOptions> = {
    now: options.now ?? (() => new Date()),
    pageDelayMs: options.pageDelayMs ?? defaultSamplePageDelayMs,
  };
  return {
    id: "sample",
    label: "Sample data",
    isSample: true,

    async geocode(location, ctx) {
      if (ctx?.signal?.aborted) throw abortError(ctx.signal);
      const result = geocodeLocation(location);
      await ctx?.onUsage?.({ operation: "geocode", requests: 1, costUsd: 0, billable: false });
      return result;
    },

    search(plan, ctx = {}) {
      return searchPages(plan, ctx, opts);
    },

    async findPlace(input, ctx) {
      if (ctx?.signal?.aborted) throw abortError(ctx.signal);
      const name = input.name?.trim();
      await ctx?.onUsage?.({ operation: "find_place", requests: 1, costUsd: 0, billable: false });
      if (!name) return null;
      let center = input.center;
      if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
        // No coordinates in the link: only a known city named in the text can place it.
        const g = geocodeLocation(name);
        if (!g || g.label === name) return null;
        center = g.center;
      }
      return findPlaceNear(name, center, opts.now());
    },

    async getDetails(ids, ctx) {
      if (ctx?.signal?.aborted) throw abortError(ctx.signal);
      const out = detailsFor(ids, opts.now());
      if (ids.length) await ctx?.onUsage?.({ operation: "place_details", requests: ids.length, costUsd: 0, billable: false });
      return out;
    },

    estimate(targetCount) {
      return sampleEstimate(targetCount);
    },
  };
}

export { CELL_DEG };
