import { conceptHtmlResponse, getConceptHtml } from "@/server/concepts";
import { uuidParam, withUser } from "@/server/http";

/**
 * GET /api/v1/concepts/{id}/html → the rendered page (owner only), for the editor preview.
 * `?download=1` → served as an attachment "<slug>-homepage-concept.html".
 */
export const GET = withUser<{ id: string }>(async (req, { user, params }) => {
  const { html, fileName } = await getConceptHtml(user, uuidParam(params.id, "Concept"));
  const download = req.nextUrl.searchParams.get("download") === "1";
  return conceptHtmlResponse(html, download ? { downloadName: fileName } : {});
});
