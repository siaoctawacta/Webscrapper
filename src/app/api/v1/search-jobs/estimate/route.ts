import { z } from "zod";
import { json, readJson, withUser } from "@/server/http";
import { estimateSearch } from "@/server/search";
import { rateLimit } from "@/server/rate-limit";

const anyBody = z.unknown();

/**
 * POST /api/v1/search-jobs/estimate (same body as create)
 * → CostEstimate & { locationLabel, targetCount, kind }. Creates nothing and spends no billable requests.
 */
export const POST = withUser(async (req, { user }) => {
  await rateLimit(`search-estimate:${user.id}`, 120, 60);
  const body = await readJson(req, anyBody);
  return json(await estimateSearch(user, body));
});
