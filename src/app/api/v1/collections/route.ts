import { json, readJson, withUser } from "@/server/http";
import { createCollection, createCollectionSchema, listCollections } from "@/server/collections";

/** GET /api/v1/collections → { collections: CollectionDto[] } (most recently used first) */
export const GET = withUser(async (_req, { user }) => {
  return json({ collections: await listCollections(user) });
});

/** POST /api/v1/collections { name, description? } → 201 CollectionDto · 409 when the name is taken */
export const POST = withUser(async (req, { user, ip }) => {
  const body = await readJson(req, createCollectionSchema);
  return json(await createCollection(user, body, { ip }), 201);
});
