import { generateConcept, listConcepts, type ConceptListResponse } from "@/server/concepts";
import { createConceptSchema } from "@/server/concepts/schema";
import { json, readJson, withUser } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/** GET /api/v1/concepts → { concepts: ConceptSummaryDto[] } (newest first, at most 50) */
export const GET = withUser(async (_req, { user }) => {
  const body: ConceptListResponse = { concepts: await listConcepts(user) };
  return json(body);
});

/**
 * POST /api/v1/concepts { ref, services, style, tone, primaryColor?, language, sections?, notes?, businessType?, contact, useAi? }
 * → 201 ConceptGenerateResponse. Unknown / other users' refs → 404. Rate limited to 20 generations per minute.
 */
export const POST = withUser(async (req, { user, ip }) => {
  await rateLimit(`concepts:generate:${user.id}`, 20, 60);
  const input = await readJson(req, createConceptSchema);
  return json(await generateConcept(user, input, {}, { ip }), 201);
});
