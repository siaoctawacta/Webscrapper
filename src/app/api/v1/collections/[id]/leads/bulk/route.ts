import { json, readJson, uuidParam, withUser } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { bulkInputFromBody, bulkLeads, bulkSchema } from "@/server/collections";

/**
 * POST /api/v1/collections/{id}/leads/bulk
 * { leadIds? | query?, action, status?, tags?, targetCollectionId? } → { affected, skipped? }
 */
export const POST = withUser<{ id: string }>(async (req, { params, user, ip }) => {
  const id = uuidParam(params.id, "Collection");
  const body = await readJson(req, bulkSchema);
  await rateLimit(`collections.bulk:${user.id}`, 30, 60);
  const { selector, action } = bulkInputFromBody(body);
  return json(await bulkLeads(user, id, selector, action, { ip }));
});
