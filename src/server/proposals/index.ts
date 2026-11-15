import "server-only";

export { draftProposal, saveProposal, listProposals, AI_UNAVAILABLE_WARNING, HISTORY_LIMIT, type DraftDeps } from "./service";
export { draftProposalSchema, saveProposalSchema, listProposalsQuerySchema, proposalRefSchema, type DraftProposalInput, type SaveProposalInput } from "./schemas";
export { buildTemplate, signOff, type TemplateInput, type TemplateOutput } from "./templates";
export { factsFromRow, whatsappDigits, type ProposalFacts } from "./facts";
export { findSharedConceptUrl, conceptShareUrl } from "./concept-link";
export type { ProposalDto, ProposalListResponse, ProposalRef, SaveProposalResponse } from "./types";
