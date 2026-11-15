import { json, readJson, withUser } from "@/server/http";
import { draftProposal, draftProposalSchema } from "@/server/proposals";
import { rateLimit } from "@/server/rate-limit";

/**
 * POST /api/v1/proposals/draft { ref: { kind, id }, topic, language, customService?, useAi? } → ProposalDraft
 * Rate limited to 30 per minute per user. Unknown / other users' refs → 404.
 */
export const POST = withUser(async (req, { user }) => {
  await rateLimit(`proposals:draft:${user.id}`, 30, 60);
  const input = await readJson(req, draftProposalSchema);
  return json(await draftProposal(user, input));
});
