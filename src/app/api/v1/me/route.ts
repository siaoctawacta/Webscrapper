import { json, withUser } from "@/server/http";
import { getMe } from "@/server/search";

/** GET /api/v1/me → MeResponse (user, limits incl. usage this month, sample mode, AI availability, providers) */
export const GET = withUser(async (_req, { user }) => json(await getMe(user)));
