import { getConceptPrefill } from "@/server/concepts";
import { prefillQuerySchema } from "@/server/concepts/schema";
import { json, notFound, withUser } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/**
 * GET /api/v1/concepts/prefill?ref_kind=result|lead&ref_id=<id> → ConceptPrefillDto
 * Suggested contact details for the concept form. Unknown / other users' businesses → 404.
 */
export const GET = withUser(async (req, { user }) => {
  const sp = req.nextUrl.searchParams;
  const q = prefillQuerySchema.safeParse({ ref_kind: sp.get("ref_kind") ?? undefined, ref_id: sp.get("ref_id") ?? undefined });
  if (!q.success) throw notFound("Business");
  await rateLimit(`concepts.prefill:${user.id}`, 60, 60);
  return json(await getConceptPrefill(user, { kind: q.data.ref_kind, id: q.data.ref_id }));
});
