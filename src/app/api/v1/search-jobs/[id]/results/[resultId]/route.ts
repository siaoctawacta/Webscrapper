import { json, uuidParam, withUser } from "@/server/http";
import { getSearchResult } from "@/server/search";

/** GET /api/v1/search-jobs/{id}/results/{resultId} → BusinessRow */
export const GET = withUser<{ id: string; resultId: string }>(async (_req, { params, user }) => {
  const jobId = uuidParam(params.id, "Search");
  const resultId = uuidParam(params.resultId, "Result");
  return json(await getSearchResult(user, resultId, jobId));
});
