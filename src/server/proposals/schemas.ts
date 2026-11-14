/**
 * Request validation for /api/v1/proposals. Pure module (zod only).
 */
import { z } from "zod";
import { LANGUAGES, PROPOSAL_CHANNELS, PROPOSAL_TOPICS } from "@/lib/domain";

export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;
export const CUSTOM_SERVICE_MAX = 200;

// Keep tabs and newlines; drop other control characters (NUL breaks Postgres text).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: string) => v.replace(/\r\n?/g, "\n").replace(CONTROL, "");

/**
 * A pointer to a search result or a saved lead. Ids are checked by the loaders: anything that is not
 * one of the user's own ids is a 404, so the schema only bounds the length.
 */
export const proposalRefSchema = z.object({
  kind: z.enum(["result", "lead"], { error: "ref.kind must be “result” or “lead”" }),
  id: z.string().trim().min(1, { error: "ref.id is required" }).max(64),
});

export const draftProposalSchema = z.object({
  ref: proposalRefSchema,
  topic: z.enum(PROPOSAL_TOPICS, { error: "Choose a topic" }),
  language: z.enum(LANGUAGES, { error: "Language must be “en” or “fr”" }),
  customService: z
    .string()
    .transform((v) => clean(v).trim())
    .pipe(z.string().max(CUSTOM_SERVICE_MAX, { error: `Describe your service in ${CUSTOM_SERVICE_MAX} characters or fewer` }))
    .nullable()
    .optional(),
  useAi: z.boolean().optional().default(false),
});
export type DraftProposalInput = z.input<typeof draftProposalSchema>;

export const saveProposalSchema = z.object({
  ref: proposalRefSchema.nullable().optional(),
  topic: z.enum(PROPOSAL_TOPICS, { error: "Choose a topic" }),
  language: z.enum(LANGUAGES, { error: "Language must be “en” or “fr”" }),
  subject: z
    .string()
    .transform((v) => clean(v).replace(/\s*\n\s*/g, " ").trim())
    .pipe(z.string().min(1, { error: "Add a subject" }).max(SUBJECT_MAX, { error: `Keep the subject under ${SUBJECT_MAX} characters` })),
  body: z
    .string()
    .transform((v) => clean(v).trim())
    .pipe(z.string().min(1, { error: "The message is empty" }).max(BODY_MAX, { error: `Keep the message under ${BODY_MAX} characters` })),
  channel: z.enum(PROPOSAL_CHANNELS, { error: "Channel must be email, whatsapp or copy" }),
  generatedBy: z.enum(["template", "ai"]),
});
export type SaveProposalInput = z.input<typeof saveProposalSchema>;

/** GET /api/v1/proposals?ref_kind=&ref_id= — both or neither. */
export const listProposalsQuerySchema = z
  .object({
    ref_kind: z.enum(["result", "lead"]).optional(),
    ref_id: z.string().trim().min(1).max(64).optional(),
  })
  .refine((q) => (q.ref_kind === undefined) === (q.ref_id === undefined), {
    error: "Pass both ref_kind and ref_id, or neither",
    path: ["ref_id"],
  });
