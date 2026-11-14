import { json, withAdmin } from "@/server/http";
import { listUsers } from "@/server/admin";

/** GET /api/v1/admin/users → AdminUsersResponse */
export const GET = withAdmin(async () => json(await listUsers()));
