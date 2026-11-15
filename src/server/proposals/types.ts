/**
 * JSON shapes for /api/v1/proposals. Types only (isomorphic) — the client imports them with `import type`.
 */
import type { Language, LeadStatus, ProposalChannel, ProposalTopic } from "@/lib/domain";

export type ProposalRef = { kind: "result" | "lead"; id: string };

/** One saved proposal (history entry). */
export type ProposalDto = {
  id: string;
  businessId: string | null;
  leadId: string | null;
  /** Name at the time of writing; null when the source policy doesn't allow storing it (Google data). */
  businessName: string | null;
  topic: ProposalTopic;
  language: Language;
  subject: string;
  body: string;
  channel: ProposalChannel | null;
  generatedBy: "template" | "ai";
  /** Set when the proposal was sent by email or WhatsApp. */
  sentAt: string | null;
  createdAt: string;
};

/** POST /api/v1/proposals → 201 */
export type SaveProposalResponse = ProposalDto & {
  /** The lead after the save (status moved to proposal_sent when it was new/contacted). */
  lead: { id: string; status: LeadStatus; lastContactedAt: string | null } | null;
};

/** GET /api/v1/proposals?ref_kind&ref_id */
export type ProposalListResponse = { proposals: ProposalDto[]; aiAvailable: boolean };
