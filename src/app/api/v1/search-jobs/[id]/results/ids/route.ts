import { parseListQuery } from "@/lib/list-query";
import { json, uuidParam, withUser } from "@/server/http";
import { listSearchResultIds } from "@/server/search";

/** GET /api/v1/search-jobs/{id}/results/ids?<list query> → { ids, total, truncated } (≤ MAX_BULK_ROWS, in sort order) */
export const GET = withUser<{ id: string }>(async (req, { params, user }) => {
  const id = uuidParam(params.id, "Search");
  const query = parseListQuery(req.nextUrl.searchParams, "results");
  return json(await listSearchResultIds(user, id, query));
});
