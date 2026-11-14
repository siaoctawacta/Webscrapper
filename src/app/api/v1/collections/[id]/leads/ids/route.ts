import { parseListQuery } from "@/lib/list-query";
import { json, uuidParam, withUser } from "@/server/http";
import { listLeadIds } from "@/server/collections";

/** GET /api/v1/collections/{id}/leads/ids?<list query> → { ids, total, truncated } (≤ MAX_BULK_ROWS, in sort order) */
export const GET = withUser<{ id: string }>(async (req, { params, user }) => {
  const id = uuidParam(params.id, "Collection");
  const query = parseListQuery(req.nextUrl.searchParams, "collection");
  return json(await listLeadIds(user, id, query));
});
