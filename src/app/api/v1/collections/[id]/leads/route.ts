import { parseListQuery } from "@/lib/list-query";
import { json, readJson, uuidParam, withUser } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { addLeadsSchema, addToCollection, listLeads } from "@/server/collections";

/** GET /api/v1/collections/{id}/leads?page&page_size&sort&filter[..]&search → ListResponse (provider fields loaded live where needed) */
export const GET = withUser<{ id: string }>(async (req, { params, user }) => {
  const id = uuidParam(params.id, "Collection");
  const query = parseListQuery(req.nextUrl.searchParams, "collection");
  // Each page may trigger billed live Google lookups, so keep page loads at a human pace.
  await rateLimit(`collections.leads:${user.id}`, 60, 60);
  return json(await listLeads(user, id, query));
});

/** POST /api/v1/collections/{id}/leads { jobId, resultIds? | query? } → { added, skipped } */
export const POST = withUser<{ id: string }>(async (req, { params, user, ip }) => {
  const id = uuidParam(params.id, "Collection");
  const body = await readJson(req, addLeadsSchema);
  await rateLimit(`collections.add:${user.id}`, 30, 60);
  const input = body.resultIds ? { jobId: body.jobId, resultIds: body.resultIds } : { jobId: body.jobId, query: body.query ?? {} };
  return json(await addToCollection(user, id, input, { ip }));
});
