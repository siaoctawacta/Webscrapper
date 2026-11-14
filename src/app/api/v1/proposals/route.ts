import { isAiAvailable } from "@/server/ai/gateway";
import { json, readJson, withUser } from "@/server/http";
import { listProposals, listProposalsQuerySchema, saveProposal, saveProposalSchema, type ProposalListResponse } from "@/server/proposals";

/**
 * GET /api/v1/proposals?ref_kind=result|lead&ref_id=<id> → { proposals: ProposalDto[], aiAvailable }
 * Without a ref: the user's latest proposals. Unknown / other users' refs → 404.
 */
export const GET = withUser(async (req, { user }) => {
  const sp = req.nextUrl.searchParams;
  const q = listProposalsQuerySchema.parse({ ref_kind: sp.get("ref_kind") ?? undefined, ref_id: sp.get("ref_id") ?? undefined });
  const ref = q.ref_kind && q.ref_id ? { kind: q.ref_kind, id: q.ref_id } : null;
  const body: ProposalListResponse = { proposals: await listProposals(user, ref), aiAvailable: isAiAvailable() };
  return json(body);
});

/**
 * POST /api/v1/proposals { ref?, topic, language, subject, body, channel, generatedBy } → 201 SaveProposalResponse
 * For leads: status → proposal_sent (from new/contacted) and last_contacted_at = now.
 */
export const POST = withUser(async (req, { user, ip }) => {
  const input = await readJson(req, saveProposalSchema);
  return json(await saveProposal(user, input, { ip }), 201);
});
