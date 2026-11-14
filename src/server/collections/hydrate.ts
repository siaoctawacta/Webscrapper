import "server-only";
import type { BusinessRow } from "@/lib/api-types";
import type { SourceId } from "@/lib/domain";
import { PAGE_SIZES } from "@/lib/list-query";
import type { AppUser } from "../auth/session";
import { HttpError } from "../errors";
import { normalizePlace } from "../normalize";
import { getPolicy } from "../providers/policy";
import { getProvider as defaultGetProvider } from "../providers/registry";
import type { BusinessProvider, ProviderPlace, UsageEvent } from "../providers/types";
import { recordUsage as defaultRecordUsage, type UsageEntry } from "../usage";
import { applyLiveDetails } from "./live-fields";

/** Max ids per provider.getDetails call. */
export const DETAILS_BATCH_SIZE = 100;
/**
 * Max rows hydrated per call: one grid page. Live details are billed per request, so hydrating is
 * only for what the user is looking at; callers that need more rows (exports) must not hydrate.
 */
export const MAX_HYDRATED_ROWS = Math.max(...PAGE_SIZES);
/** Give up on live details after this long so a slow provider never stalls the collection page. */
export const LIVE_DETAILS_TIMEOUT_MS = 15_000;

export type HydrateDeps = {
  getProvider?: (id: SourceId) => BusinessProvider;
  recordUsage?: (u: UsageEntry) => Promise<unknown>;
  /** Override MAX_HYDRATED_ROWS (tests). */
  maxRows?: number;
  /** Override LIVE_DETAILS_TIMEOUT_MS (tests). */
  timeoutMs?: number;
};

const warnedNotConfigured = new Set<SourceId>();

/**
 * Fill provider fields that the source policy forbids storing (restrictedFields) by fetching them
 * live from the provider, for display only. Records usage. Never throws: on failure rows are returned
 * unchanged (restricted fields stay null).
 *
 * - Only rows whose source policy supports live details are looked up, at most MAX_HYDRATED_ROWS.
 * - Every restricted field of a row the provider returned is listed in `liveFields` (also when the
 *   live value is empty), so the UI can tell "not stored" apart from "the provider has no value".
 * - Rows the provider did not return (removed places) are left as stored.
 * - Live values are never written to the database.
 */
export async function hydrateRows(user: AppUser, rows: BusinessRow[], deps: HydrateDeps = {}): Promise<BusinessRow[]> {
  try {
    return await hydrate(user, rows, deps);
  } catch (e) {
    console.error("[collections] live details failed; showing stored data only:", e instanceof Error ? e.message : e);
    return rows;
  }
}

async function hydrate(user: AppUser, rows: BusinessRow[], deps: HydrateDeps): Promise<BusinessRow[]> {
  const getProvider = deps.getProvider ?? defaultGetProvider;
  const record = deps.recordUsage ?? defaultRecordUsage;
  const maxRows = deps.maxRows ?? MAX_HYDRATED_ROWS;

  // Which row indexes need live data, grouped by source.
  const bySource = new Map<SourceId, number[]>();
  let considered = 0;
  rows.forEach((row, i) => {
    if (!row.restrictedFields.length || !getPolicy(row.source).supportsLiveDetails) return;
    if (considered >= maxRows) return;
    considered += 1;
    const list = bySource.get(row.source) ?? [];
    list.push(i);
    bySource.set(row.source, list);
  });
  if (!bySource.size) return rows;

  const out = [...rows];
  for (const [source, indexes] of bySource) {
    let provider: BusinessProvider;
    try {
      provider = getProvider(source);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      // Expected when the provider key is not configured: rows keep their restricted fields empty.
      if (!warnedNotConfigured.has(source)) {
        warnedNotConfigured.add(source);
        console.warn(`[collections] live details unavailable for ${source}: ${e.message}`);
      }
      continue;
    }

    const usageWrites: Promise<unknown>[] = [];
    const onUsage = (u: UsageEvent) => {
      usageWrites.push(
        record({
          userId: user.id,
          provider: source,
          operation: u.operation,
          requestCount: u.requests,
          billable: u.billable,
          estimatedCostUsd: u.costUsd,
        }).catch((err: unknown) => console.error("[collections] could not record usage", err)),
      );
    };

    const ids = [...new Set(indexes.map((i) => rows[i]!.sourceRecordId))];
    const signal = AbortSignal.timeout(deps.timeoutMs ?? LIVE_DETAILS_TIMEOUT_MS);
    let live: Map<string, ProviderPlace>;
    try {
      live = new Map();
      for (let start = 0; start < ids.length; start += DETAILS_BATCH_SIZE) {
        const found = await provider.getDetails(ids.slice(start, start + DETAILS_BATCH_SIZE), { onUsage, signal });
        for (const [id, place] of found) live.set(id, place);
      }
    } catch (e) {
      // Key/billing/quota/outage/timeout: this source's rows stay exactly as stored.
      console.error(`[collections] live details from ${source} failed; showing stored data only:`, e instanceof Error ? e.message : e);
      continue;
    } finally {
      // Requests that were made are billed even when the batch failed, so always record them.
      await Promise.all(usageWrites);
    }

    const retrievedAt = new Date();
    for (const i of indexes) {
      const row = rows[i]!;
      const place = live.get(row.sourceRecordId);
      if (!place) continue;
      out[i] = applyLiveDetails(row, normalizePlace(place, { source, retrievedAt }));
    }
  }
  return out;
}
