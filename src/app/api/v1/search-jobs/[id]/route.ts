import { json, uuidParam, withUser } from "@/server/http";
import { deleteSearchJob, getSearchJob } from "@/server/search";

/** GET /api/v1/search-jobs/{id} → SearchJobDto (with counts) */
export const GET = withUser<{ id: string }>(async (_req, { params, user }) => {
  return json(await getSearchJob(user, uuidParam(params.id, "Search")));
});

/** DELETE /api/v1/search-jobs/{id} → 204 (the job, its results and events are deleted; a running job is stopped) */
export const DELETE = withUser<{ id: string }>(async (_req, { params, user, ip }) => {
  await deleteSearchJob(user, uuidParam(params.id, "Search"), { ip });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
