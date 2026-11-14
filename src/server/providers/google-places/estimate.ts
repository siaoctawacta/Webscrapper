/** Pure cost estimate for Google Text Search (ARCHITECTURE §4.2). */
import type { CostEstimateResult } from "../types";

export const PAGE_SIZE = 20;
/** Text Search returns at most 3 pages (60 places) per query. */
export const SINGLE_QUERY_MAX = 60;
export const GOOGLE_FREE_MONTHLY_TEXT_SEARCH = 1000;

const roundUsd = (v: number) => Math.round(v * 10_000) / 10_000;

export function estimateGoogleTextSearch(targetCount: number, textSearchPricePer1000: number): CostEstimateResult {
  const target = Number.isFinite(targetCount) && targetCount > 0 ? Math.ceil(targetCount) : 1;
  const price = Number.isFinite(textSearchPricePer1000) && textSearchPricePer1000 > 0 ? textSearchPricePer1000 : 0;
  const pages = Math.ceil(target / PAGE_SIZE);
  const tiled = target > SINGLE_QUERY_MAX;
  const estimatedRequests = tiled ? Math.ceil(pages * 1.6) + 4 : pages;
  const maxRequests = Math.ceil(estimatedRequests * 1.5) + 5;
  const estimatedCostUsd = roundUsd((estimatedRequests * price) / 1000);
  const maxCostUsd = roundUsd((maxRequests * price) / 1000);

  const notes = [
    `Google gives ${GOOGLE_FREE_MONTHLY_TEXT_SEARCH.toLocaleString("en-US")} free Text Search (Enterprise) requests per month. Actual billing happens on your own Google Cloud account, not in this app.`,
    `This search stops after at most ${maxRequests} requests (about $${maxCostUsd.toFixed(2)}).`,
  ];
  if (tiled) {
    notes.push(
      "Google returns at most 60 businesses per search, so large searches split the map into smaller areas. The final number of requests depends on how many businesses the area has.",
    );
  }
  return { estimatedRequests, maxRequests, estimatedCostUsd, freeMonthlyRequests: GOOGLE_FREE_MONTHLY_TEXT_SEARCH, notes };
}
