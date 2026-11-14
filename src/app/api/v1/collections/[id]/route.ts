import { json, readJson, uuidParam, withUser } from "@/server/http";
import { deleteCollection, getCollection, renameCollection, updateCollectionSchema } from "@/server/collections";

/** GET /api/v1/collections/{id} → CollectionDto */
export const GET = withUser<{ id: string }>(async (_req, { params, user }) => {
  return json(await getCollection(user, uuidParam(params.id, "Collection")));
});

/** PATCH /api/v1/collections/{id} { name?, description? } → CollectionDto */
export const PATCH = withUser<{ id: string }>(async (req, { params, user, ip }) => {
  const id = uuidParam(params.id, "Collection");
  const patch = await readJson(req, updateCollectionSchema);
  return json(await renameCollection(user, id, patch, { ip }));
});

/** DELETE /api/v1/collections/{id} → 204 (its leads are removed too) */
export const DELETE = withUser<{ id: string }>(async (_req, { params, user, ip }) => {
  await deleteCollection(user, uuidParam(params.id, "Collection"), { ip });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
