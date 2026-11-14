import { uuidParam, withAdmin } from "@/server/http";
import { revokeInvitation } from "@/server/admin";

/** DELETE /api/v1/admin/invitations/{id} → 204 (only invitations that have not been used) */
export const DELETE = withAdmin<{ id: string }>(async (_req, { params, user, ip }) => {
  await revokeInvitation(user, uuidParam(params.id, "Invitation"), { ip });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
