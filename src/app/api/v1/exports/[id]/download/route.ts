import { uuidParam, withUser } from "@/server/http";
import { openDownload } from "@/server/exports";

/**
 * GET /api/v1/exports/{id}/download?token=… → the file (owner only).
 * 403 when the link is wrong or expired, 404 when the export or its file has expired.
 */
export const GET = withUser<{ id: string }>(async (req, { params, user, ip }) => {
  return openDownload(user, uuidParam(params.id, "Export"), req.nextUrl.searchParams.get("token"), { ip });
});
