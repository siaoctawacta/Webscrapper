import { json, readJson, withAdmin } from "@/server/http";
import { adminUserPatchSchema, updateUser, userIdParam } from "@/server/admin";

/** PATCH /api/v1/admin/users/{id} { status?, role?, maxResultsPerSearch?, monthlyRequestLimit? } → AdminUserDto */
export const PATCH = withAdmin<{ id: string }>(async (req, { params, user, ip }) => {
  const id = userIdParam(params.id);
  const patch = await readJson(req, adminUserPatchSchema);
  return json(await updateUser(user, id, patch, { ip }));
});
