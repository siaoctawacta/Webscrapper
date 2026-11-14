import { json, withAdmin } from "@/server/http";
import { usageByUserMonth } from "@/server/admin";

/** GET /api/v1/admin/usage → UsageResponse (billable requests and estimated cost by user × month, last 6 months) */
export const GET = withAdmin(async () => json(await usageByUserMonth({ months: 6 })));
