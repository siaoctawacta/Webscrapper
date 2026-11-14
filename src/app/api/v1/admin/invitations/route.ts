import { json, readJson, withAdmin } from "@/server/http";
import { createInvitation, invitationCreateSchema, listInvitations, type InvitationsResponse } from "@/server/admin";
import { env } from "@/server/env";

/** GET /api/v1/admin/invitations → InvitationsResponse */
export const GET = withAdmin(async () =>
  json<InvitationsResponse>({ invitations: await listInvitations(), signupMode: env().SIGNUP_MODE }),
);

/** POST /api/v1/admin/invitations { email, role? } → 201 InvitationDto */
export const POST = withAdmin(async (req, { user, ip }) => {
  const input = await readJson(req, invitationCreateSchema);
  return json(await createInvitation(user, input, { ip }), 201);
});
