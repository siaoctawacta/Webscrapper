import { json, readJson, withUser } from "@/server/http";
import { getSenderProfile, senderProfileInputSchema, updateSenderProfile } from "@/server/settings";

/** GET /api/v1/me/settings → SenderProfile (nulls when unset) */
export const GET = withUser(async (_req, { user }) => json(await getSenderProfile(user)));

/** PUT /api/v1/me/settings Partial<SenderProfile> → SenderProfile. Absent keys are kept; null or "" clears. */
export const PUT = withUser(async (req, { user, ip }) => {
  const input = await readJson(req, senderProfileInputSchema);
  return json(await updateSenderProfile(user, input, { ip }));
});
