import { parseListQuery } from "@/lib/list-query";
import { json, uuidParam, withUser } from "@/server/http";
import { listSearchResults } from "@/server/search";

/** GET /api/v1/search-jobs/{id}/results?<list query> → ListResponse */
export const GET = withUser<{ id: string }>(async (req, { params, user }) => {
  const id = uuidParam(params.id, "Search");
  const query = parseListQuery(req.nextUrl.searchParams, "results");
  return json(await listSearchResults(user, id, query));
});
