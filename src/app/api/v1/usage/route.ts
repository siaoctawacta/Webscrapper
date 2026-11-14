import { HttpError, json, withUser } from "@/server/http";
import { usageReport } from "@/server/search";

/**
 * GET /api/v1/usage → UsageReport: own provider requests and estimated cost for the last 6 months,
 * grouped by month, provider and operation. Admins may pass ?all=1 to see every user (grouped by user too).
 */
export const GET = withUser(async (req, { user }) => {
  const allParam = req.nextUrl.searchParams.get("all");
  const all = allParam === "1" || allParam === "true";
  if (all && user.role !== "admin") throw new HttpError("forbidden", "Only administrators can see everyone's usage.");
  return json(await usageReport(user, { all }));
});
