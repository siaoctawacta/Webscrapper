/**
 * Request body schemas for the collections and leads API (pure, isomorphic zod).
 * List queries inside bodies are validated separately with validateListQuery (allowlists).
 */
import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/domain";
import { MAX_BULK_ROWS } from "@/lib/list-query";

export const MAX_COLLECTION_NAME = 80;
export const MAX_COLLECTION_DESCRIPTION = 500;
export const MAX_NOTES_LENGTH = 10_000;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export const collectionNameSchema = z
  .string()
  .transform(collapse)
  .pipe(
    z
      .string()
      .min(1, "Give the collection a name")
      .max(MAX_COLLECTION_NAME, `Collection names can be at most ${MAX_COLLECTION_NAME} characters`),
  );

/** Empty / blank → null (clears the description). */
export const collectionDescriptionSchema = z
  .string()
  .max(MAX_COLLECTION_DESCRIPTION * 2)
  .transform((s) => s.trim() || null)
  .pipe(z.string().max(MAX_COLLECTION_DESCRIPTION, `Descriptions can be at most ${MAX_COLLECTION_DESCRIPTION} characters`).nullable())
  .nullable();

export const createCollectionSchema = z.object({
  name: collectionNameSchema,
  description: collectionDescriptionSchema.optional(),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z.object({
  name: collectionNameSchema.optional(),
  description: collectionDescriptionSchema.optional(),
});
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

const idList = z.array(z.string().uuid("Invalid id")).min(1, "Select at least one row").max(MAX_BULK_ROWS, `At most ${MAX_BULK_ROWS} rows at once`);

/** POST /collections/{id}/leads — either explicit result ids or a results-grid query (all matching). */
export const addLeadsSchema = z
  .object({
    jobId: z.string().uuid("Invalid search id"),
    resultIds: idList.optional(),
    query: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => (v.resultIds === undefined) !== (v.query === undefined), {
    message: "Send either resultIds or query",
    path: ["resultIds"],
  });
export type AddLeadsBody = z.infer<typeof addLeadsSchema>;

/** Raw tag input; normalizeTags applies the real limits. */
const rawTags = z.array(z.string().max(200, "Tags can be at most 40 characters")).max(100, "A lead can have at most 30 tags");

export const leadPatchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  tags: rawTags.optional(),
  notes: z.string().max(MAX_NOTES_LENGTH, `Notes can be at most ${MAX_NOTES_LENGTH.toLocaleString("en")} characters`).optional(),
});
export type LeadPatchBody = z.infer<typeof leadPatchSchema>;

export const BULK_ACTIONS = ["set_status", "add_tags", "remove_tags", "replace_tags", "copy_to", "move_to", "remove"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export const bulkSchema = z
  .object({
    leadIds: idList.optional(),
    query: z.record(z.string(), z.unknown()).optional(),
    action: z.enum(BULK_ACTIONS),
    status: z.enum(LEAD_STATUSES).optional(),
    tags: rawTags.optional(),
    targetCollectionId: z.string().uuid("Invalid collection id").optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.leadIds === undefined) === (v.query === undefined)) {
      ctx.addIssue({ code: "custom", message: "Send either leadIds or query", path: ["leadIds"] });
    }
    if (v.action === "set_status" && !v.status) {
      ctx.addIssue({ code: "custom", message: "Choose a status", path: ["status"] });
    }
    if ((v.action === "add_tags" || v.action === "remove_tags") && !v.tags?.some((t) => t.trim())) {
      ctx.addIssue({ code: "custom", message: "Enter at least one tag", path: ["tags"] });
    }
    if (v.action === "replace_tags" && !v.tags) {
      ctx.addIssue({ code: "custom", message: "Send the new tags (an empty list clears them)", path: ["tags"] });
    }
    if ((v.action === "copy_to" || v.action === "move_to") && !v.targetCollectionId) {
      ctx.addIssue({ code: "custom", message: "Choose a target collection", path: ["targetCollectionId"] });
    }
  });
export type BulkBody = z.infer<typeof bulkSchema>;
