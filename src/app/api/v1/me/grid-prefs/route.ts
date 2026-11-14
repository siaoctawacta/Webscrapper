import { gridPrefsPatchSchema } from "@/lib/grid-prefs";
import { json, readJson, withUser } from "@/server/http";
import { getGridPrefs, updateGridPrefs } from "@/server/settings";

/** GET /api/v1/me/grid-prefs → GridPrefs */
export const GET = withUser(async (_req, { user }) => json(await getGridPrefs(user)));

/**
 * PUT /api/v1/me/grid-prefs { results?: { columns?, pageSize? } | null, collection?: … | null } → GridPrefs
 * Merges per context: contexts not sent are kept, null resets a context to the defaults.
 */
export const PUT = withUser(async (req, { user }) => {
  const patch = await readJson(req, gridPrefsPatchSchema);
  return json(await updateGridPrefs(user, patch));
});
