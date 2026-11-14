import { json, readJson, uuidParam, withUser } from "@/server/http";
import { deleteLead, leadPatchSchema, updateLead } from "@/server/collections";

/** PATCH /api/v1/leads/{id} { status?, tags?, notes? } → BusinessRow (not re-hydrated: the UI keeps the live fields it shows) */
export const PATCH = withUser<{ id: string }>(async (req, { params, user, ip }) => {
  const id = uuidParam(params.id, "Lead");
  const patch = await readJson(req, leadPatchSchema);
  return json(await updateLead(user, id, patch, { ip }));
});

/** DELETE /api/v1/leads/{id} → 204 (removes the lead from its collection) */
export const DELETE = withUser<{ id: string }>(async (_req, { params, user, ip }) => {
  await deleteLead(user, uuidParam(params.id, "Lead"), { ip });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
