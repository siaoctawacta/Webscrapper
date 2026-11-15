import { regenerateConcept } from "@/server/concepts";
import { regenerateConceptSchema } from "@/server/concepts/schema";
import { json, readJson, uuidParam, withUser } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/**
 * POST /api/v1/concepts/{id}/regenerate { input?, useAi? } → ConceptGenerateResponse
 * Without `input` the saved options are reused. Shares the 20-per-minute generation limit.
 */
export const POST = withUser<{ id: string }>(async (req, { user, params }) => {
  const id = uuidParam(params.id, "Concept");
  await rateLimit(`concepts:generate:${user.id}`, 20, 60);
  const body = await readJson(req, regenerateConceptSchema);
  return json(await regenerateConcept(user, id, body));
});
