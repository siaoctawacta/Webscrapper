import { json, uuidParam, withUser } from "@/server/http";
import { getExport } from "@/server/exports";

/** GET /api/v1/exports/{id} → ExportDto; when ready it carries a fresh short-lived downloadUrl. */
export const GET = withUser<{ id: string }>(async (_req, { params, user }) => {
  return json(await getExport(user, uuidParam(params.id, "Export")));
});
