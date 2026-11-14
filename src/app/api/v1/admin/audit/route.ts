import { json, withAdmin } from "@/server/http";
import { auditQuerySchema, listAuditLog } from "@/server/admin";

/** GET /api/v1/admin/audit?page&action → AuditLogResponse (newest first, 50 per page, action = prefix filter) */
export const GET = withAdmin(async (req) => {
  const sp = req.nextUrl.searchParams;
  const query = auditQuerySchema.parse({ page: sp.get("page") ?? undefined, action: sp.get("action") ?? undefined });
  return json(await listAuditLog(query));
});
