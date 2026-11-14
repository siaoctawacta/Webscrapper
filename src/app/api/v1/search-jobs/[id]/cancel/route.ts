import { json, uuidParam, withUser } from "@/server/http";
import { cancelSearchJob } from "@/server/search";

/** POST /api/v1/search-jobs/{id}/cancel → SearchJobDto (queued jobs stop at once; running jobs stop at the next check) */
export const POST = withUser<{ id: string }>(async (_req, { params, user, ip }) => {
  return json(await cancelSearchJob(user, uuidParam(params.id, "Search"), { ip }));
});
