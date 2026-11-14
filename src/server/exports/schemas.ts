/**
 * Request validation for POST /api/v1/exports (pure).
 */
import { z } from "zod";
import { EXPORT_FORMATS, EXPORT_SCOPES, type ExportFormat, type ExportScope } from "@/lib/domain";
import { FIELDS, isFieldKey, type FieldContext, type FieldKey } from "@/lib/fields";
import { MAX_BULK_ROWS, validateListQuery, type ListQuery } from "@/lib/list-query";
import type { ExportTargetRef } from "./row-source";

/** Largest export (selected ids or all filtered rows). */
export const EXPORT_MAX_ROWS = MAX_BULK_ROWS;
export const MAX_EXPORT_COLUMNS = 40;
/** Exports up to this many rows are generated during the request; larger ones run in the worker. */
export const INLINE_ROW_LIMIT = 2000;
/** Page size used to read "all filtered rows". */
export const FILTERED_PAGE_SIZE = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (message: string) => z.string().regex(UUID_RE, message);

export const contextFor = (target: "search" | "collection"): FieldContext => (target === "search" ? "results" : "collection");

export const createExportSchema = z
  .object({
    target: z.enum(["search", "collection"], { message: "Choose what to export: search results or a collection." }),
    jobId: uuid("Unknown search").nullish(),
    collectionId: uuid("Unknown collection").nullish(),
    format: z.enum(EXPORT_FORMATS, { message: "Choose Excel (xlsx) or CSV." }),
    scope: z.enum(EXPORT_SCOPES, { message: "Choose which rows to export." }),
    columns: z
      .array(z.string(), { message: "Choose the columns to export." })
      .min(1, "Choose at least one column to export.")
      .max(MAX_EXPORT_COLUMNS, `You can export at most ${MAX_EXPORT_COLUMNS} columns.`),
    includeAnnotations: z.boolean().nullish(),
    query: z.unknown().optional(),
    rowIds: z
      .array(uuid("Some selected rows are not valid."))
      .max(EXPORT_MAX_ROWS, `You can export at most ${EXPORT_MAX_ROWS.toLocaleString("en-US")} rows at a time.`)
      .nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.target === "search" && !v.jobId) ctx.addIssue({ code: "custom", path: ["jobId"], message: "Choose the search to export." });
    if (v.target === "collection" && !v.collectionId)
      ctx.addIssue({ code: "custom", path: ["collectionId"], message: "Choose the collection to export." });
    const context = contextFor(v.target);
    v.columns.forEach((c, i) => {
      if (!isFieldKey(c) || !FIELDS[c].contexts.includes(context))
        ctx.addIssue({ code: "custom", path: ["columns", i], message: `“${c}” is not a column you can export here.` });
    });
    if (v.scope === "selected" && !v.rowIds?.length)
      ctx.addIssue({ code: "custom", path: ["rowIds"], message: "Select at least one row to export." });
  });

export type CreateExportInput = {
  ref: ExportTargetRef;
  context: FieldContext;
  format: ExportFormat;
  scope: ExportScope;
  /** Chosen columns, deduplicated, in the order given. */
  columns: FieldKey[];
  includeAnnotations: boolean;
  query: ListQuery;
  /** Selected ids (scope "selected" only), deduplicated. */
  rowIds: string[] | null;
};

/** Validate a create-export body. Throws ZodError / ListQueryError (both → 422). */
export function parseCreateExportInput(raw: unknown): CreateExportInput {
  const v = createExportSchema.parse(raw);
  const context = contextFor(v.target);
  const ref: ExportTargetRef = v.target === "search" ? { target: "search", jobId: v.jobId!.toLowerCase() } : { target: "collection", collectionId: v.collectionId!.toLowerCase() };
  return {
    ref,
    context,
    format: v.format,
    scope: v.scope,
    columns: [...new Set(v.columns.filter(isFieldKey))],
    includeAnnotations: v.target === "collection" && v.includeAnnotations === true,
    query: validateListQuery(v.query ?? {}, context),
    rowIds: v.scope === "selected" ? [...new Set((v.rowIds ?? []).map((id) => id.toLowerCase()))] : null,
  };
}
