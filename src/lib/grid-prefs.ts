/**
 * Saved grid preferences (visible columns, page size) per grid context.
 * Isomorphic: the grid UI uses the types and helpers, the server validates and merges with them.
 *
 * Stored in `user_settings.grid_prefs` as `{ results?: GridContextPrefs, collection?: GridContextPrefs }`
 * and served by GET/PUT /api/v1/me/grid-prefs.
 */
import { z } from "zod";
import { defaultColumns, fieldsFor, isFieldKey, type FieldContext, type FieldKey } from "./fields";
import { PAGE_SIZES } from "./list-query";

export const GRID_CONTEXTS = ["results", "collection"] as const satisfies readonly FieldContext[];
export const MAX_GRID_COLUMNS = 40;

export type GridPageSize = (typeof PAGE_SIZES)[number];

export type GridContextPrefs = {
  /** Visible columns, in display order. */
  columns: FieldKey[];
  pageSize?: GridPageSize;
};

export type GridPrefs = { [K in FieldContext]?: GridContextPrefs };

/** Body of PUT /api/v1/me/grid-prefs: per context, a partial update, or `null` to reset to defaults. */
export type GridPrefsPatch = { [K in FieldContext]?: Partial<GridContextPrefs> | null };

const pageSizeSchema = z.literal(PAGE_SIZES, { error: `Page size must be one of ${PAGE_SIZES.join(", ")}` });

/** Column list for one context: known keys only, available in that grid, de-duplicated (first wins), 1–40 entries. */
export function columnsSchema(ctx: FieldContext) {
  const allowed = new Set<string>(fieldsFor(ctx));
  return z
    .array(z.string(), { error: "columns must be a list of field keys" })
    .min(1, { error: "Choose at least one column" })
    .max(MAX_GRID_COLUMNS, { error: `At most ${MAX_GRID_COLUMNS} columns` })
    .superRefine((cols, c) => {
      cols.forEach((col, i) => {
        if (!allowed.has(col)) {
          c.addIssue({
            code: "custom",
            path: [i],
            message: isFieldKey(col) ? `Column "${col}" is not available in this grid` : `Unknown column "${col}"`,
          });
        }
      });
    })
    .transform((cols) => [...new Set(cols)] as FieldKey[]);
}

export function gridContextPatchSchema(ctx: FieldContext) {
  return z
    .object({ columns: columnsSchema(ctx).optional(), pageSize: pageSizeSchema.optional() })
    .refine((v) => v.columns !== undefined || v.pageSize !== undefined, { error: "Nothing to update" });
}

export const gridPrefsPatchSchema = z
  .object({
    results: gridContextPatchSchema("results").nullable().optional(),
    collection: gridContextPatchSchema("collection").nullable().optional(),
  })
  .strict();

/**
 * Read stored preferences leniently: anything malformed or no longer valid (e.g. a column removed
 * from the field registry) is dropped instead of failing, so old data never breaks the grid.
 */
export function parseStoredGridPrefs(raw: unknown): GridPrefs {
  const out: GridPrefs = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const ctx of GRID_CONTEXTS) {
    const v = obj[ctx];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const { columns, pageSize } = v as { columns?: unknown; pageSize?: unknown };
    const allowed = new Set<string>(fieldsFor(ctx));
    const cols = Array.isArray(columns)
      ? [...new Set(columns.filter((c): c is FieldKey => typeof c === "string" && allowed.has(c)))].slice(0, MAX_GRID_COLUMNS)
      : [];
    const size = (PAGE_SIZES as readonly unknown[]).includes(pageSize) ? (pageSize as GridPageSize) : undefined;
    if (cols.length === 0 && size === undefined) continue;
    out[ctx] = { columns: cols.length ? cols : defaultColumns(ctx), ...(size !== undefined ? { pageSize: size } : {}) };
  }
  return out;
}

/**
 * Apply a validated patch. Contexts absent from the patch are kept; `null` removes a context's
 * preferences; an object updates only the keys it contains.
 */
export function mergeGridPrefs(current: GridPrefs, patch: GridPrefsPatch): GridPrefs {
  const next: GridPrefs = { ...current };
  for (const ctx of GRID_CONTEXTS) {
    if (!(ctx in patch)) continue;
    const p = patch[ctx];
    if (p === undefined) continue;
    if (p === null) {
      delete next[ctx];
      continue;
    }
    const prev = next[ctx];
    const columns = p.columns ?? prev?.columns ?? defaultColumns(ctx);
    const pageSize = p.pageSize ?? prev?.pageSize;
    next[ctx] = { columns, ...(pageSize !== undefined ? { pageSize } : {}) };
  }
  return next;
}

/** Columns to show for a context: saved preference or the registry defaults. */
export const columnsFor = (prefs: GridPrefs | undefined, ctx: FieldContext): FieldKey[] =>
  prefs?.[ctx]?.columns?.length ? prefs[ctx]!.columns : defaultColumns(ctx);
