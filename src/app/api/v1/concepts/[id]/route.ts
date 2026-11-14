import { deleteConcept, getConcept, updateConcept } from "@/server/concepts";
import { updateConceptSchema } from "@/server/concepts/schema";
import { json, readJson, uuidParam, withUser } from "@/server/http";

type P = { id: string };

/** GET /api/v1/concepts/{id} → ConceptDto */
export const GET = withUser<P>(async (_req, { user, params }) => json(await getConcept(user, uuidParam(params.id, "Concept"))));

/** PATCH /api/v1/concepts/{id} { content?, input?, shareEnabled? } → ConceptDto */
export const PATCH = withUser<P>(async (req, { user, params, ip }) => {
  const id = uuidParam(params.id, "Concept");
  const body = await readJson(req, updateConceptSchema);
  return json(await updateConcept(user, id, body, { ip }));
});

/** DELETE /api/v1/concepts/{id} → 204 */
export const DELETE = withUser<P>(async (_req, { user, params, ip }) => {
  await deleteConcept(user, uuidParam(params.id, "Concept"), { ip });
  return new Response(null, { status: 204 });
});
