import { conceptHtmlResponse, conceptMessagePage, getSharedConceptHtml } from "@/server/concepts";
import { HttpError, withPublic } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/**
 * GET /c/{token} — public, shared homepage concept (only while its owner has sharing turned on).
 * Static HTML under a strict CSP, never indexed. Rate limited to 60 requests per minute per IP.
 */
export const GET = withPublic<{ token: string }>(async (_req, { params, ip }) => {
  try {
    await rateLimit(`concepts:public:${ip ?? "unknown"}`, 60, 60);
  } catch (e) {
    if (e instanceof HttpError && e.code === "rate_limited") {
      const page = conceptMessagePage("Too many requests", "Please wait a minute and reload the page.");
      return conceptHtmlResponse(page, { status: 429, isPublic: false, headers: { "Retry-After": "60" } });
    }
    throw e;
  }
  const html = await getSharedConceptHtml(typeof params.token === "string" ? params.token : "");
  if (!html) {
    const page = conceptMessagePage("This concept isn’t available", "The link may be wrong, or its owner has stopped sharing it.");
    return conceptHtmlResponse(page, { status: 404 });
  }
  return conceptHtmlResponse(html, { isPublic: true });
});
