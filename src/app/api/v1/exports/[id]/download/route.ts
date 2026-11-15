import { HttpError, uuidParam, withUser } from "@/server/http";
import { openDownload } from "@/server/exports";

/**
 * GET /api/v1/exports/{id}/download?token=… → the file (owner only).
 * 403 when the link is wrong or expired, 404 when the export or its file has expired, 409 while it
 * is not ready. Browser navigations get the message as plain text instead of JSON.
 */
export const GET = withUser<{ id: string }>(async (req, { params, user, ip }) => {
  try {
    return await openDownload(user, uuidParam(params.id, "Export"), req.nextUrl.searchParams.get("token"), { ip });
  } catch (e) {
    if (e instanceof HttpError && (req.headers.get("accept") ?? "").includes("text/html")) {
      return new Response(e.message, {
        status: e.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    throw e;
  }
});
