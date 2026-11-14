/**
 * Adaptive quadtree tiling over Text Search (pure: the HTTP call is injected).
 *
 * Text Search returns at most 60 places (3 pages × 20) per query. For bigger targets we search a
 * cell; if it was saturated (3 full pages) and is still larger than ~300 m, we split it into four
 * children and queue them — densest first, estimated from where the parent's results fell. We stop
 * at the target unique count, the request budget, when the area is exhausted, or on abort.
 */
import type { Rect } from "@/lib/domain";
import type { ProviderPlace, SearchPage, SearchPlan } from "../types";
import { PAGE_SIZE, SINGLE_QUERY_MAX } from "./estimate";
import { normalizeArea, rectAreaKm2, rectContains, rectSizeMeters, splitRect } from "./geo";

export const PAGES_PER_CELL = 3;
/** Cells are not split below this size (meters along their longer side). */
export const MIN_CELL_METERS = 300;

export type CellResult = { places: ProviderPlace[]; nextPageToken: string | null };

export interface TilerDeps {
  /** One Text Search request for a cell (one page). */
  searchCell: (cell: Rect, pageToken: string | undefined) => Promise<CellResult>;
  signal?: AbortSignal;
  onNote?: (message: string) => void;
}

type QueuedCell = { rect: Rect; priority: number; seq: number };

/** Highest priority first; equal priorities keep insertion order. */
class CellQueue {
  private items: QueuedCell[] = [];
  private seq = 0;

  get size() {
    return this.items.length;
  }

  push(rect: Rect, priority: number) {
    const item = { rect, priority, seq: this.seq++ };
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.items[mid]!;
      if (m.priority > priority || (m.priority === priority && m.seq < item.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.items.splice(lo, 0, item);
  }

  pop(): QueuedCell | undefined {
    return this.items.shift();
  }
}

export function canSplit(rect: Rect): boolean {
  const { width, height } = rectSizeMeters(rect);
  // Children would still be at least ~MIN_CELL_METERS along their longer side.
  return Math.max(width, height) / 2 >= MIN_CELL_METERS;
}

export async function* tiledSearch(plan: SearchPlan, deps: TilerDeps): AsyncGenerator<SearchPage, void, undefined> {
  const target = Number.isFinite(plan.targetCount) && plan.targetCount > 0 ? Math.ceil(plan.targetCount) : PAGE_SIZE;
  const maxRequests = Number.isFinite(plan.maxRequests) ? Math.max(0, Math.floor(plan.maxRequests)) : 0;
  const tiling = target > SINGLE_QUERY_MAX;
  const aborted = () => deps.signal?.aborted === true;

  const seen = new Set<string>();
  const queue = new CellQueue();
  queue.push(normalizeArea(plan.area, plan.center, MIN_CELL_METERS * 2), Number.POSITIVE_INFINITY);
  let tilesTotal = 1;
  let tilesDone = 0;
  let requests = 0;
  let denseLeftovers = 0;

  while (queue.size > 0) {
    const cell = queue.pop()!;
    const cellPlaces = new Map<string, ProviderPlace>();
    let pageToken: string | undefined;
    let pages = 0;

    for (;;) {
      if (aborted()) return;
      if (requests >= maxRequests) {
        deps.onNote?.(`Request budget reached (${requests} requests) — stopped with ${seen.size} businesses found.`);
        return;
      }

      let res: CellResult;
      try {
        res = await deps.searchCell(cell.rect, pageToken);
      } catch (e) {
        if (aborted()) return;
        throw e;
      }
      requests += 1;
      pages += 1;
      for (const p of res.places) {
        seen.add(p.sourceRecordId);
        cellPlaces.set(p.sourceRecordId, p);
      }
      pageToken = res.nextPageToken ?? undefined;

      const targetReached = seen.size >= target;
      const cellDone = targetReached || pageToken === undefined || pages >= PAGES_PER_CELL;
      if (cellDone) {
        tilesDone += 1;
        const saturated = pages >= PAGES_PER_CELL && (pageToken !== undefined || cellPlaces.size >= SINGLE_QUERY_MAX);
        if (tiling && saturated && !targetReached) {
          if (canSplit(cell.rect)) {
            for (const child of splitRect(cell.rect)) {
              let inside = 0;
              for (const p of cellPlaces.values()) {
                if (p.lat !== null && p.lng !== null && rectContains(child, p.lat, p.lng)) inside += 1;
              }
              queue.push(child, inside / rectAreaKm2(child));
            }
            tilesTotal += 4;
          } else {
            denseLeftovers += 1;
          }
        }
      }

      const exhausted = cellDone && !targetReached && queue.size === 0;
      if (exhausted && denseLeftovers > 0) {
        deps.onNote?.(
          `Some very dense spots (${denseLeftovers}) may hold more businesses than Google returns for a single search.`,
        );
      }
      yield { places: res.places, tilesDone, tilesTotal, ...(exhausted ? { exhausted: true } : {}) };
      if (targetReached || aborted()) return;
      if (cellDone) break;
    }
  }
}
