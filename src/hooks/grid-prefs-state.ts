/**
 * Pure logic behind useGridColumns: where the effective column layout comes from.
 * Precedence: edits made in this session > server prefs > this browser's saved copy > defaults.
 */
import type { FieldContext, FieldKey } from "@/lib/fields";
import { parseStoredGridPrefs, type GridContextPrefs, type GridPageSize } from "@/lib/grid-prefs";
import { normalizeColumns, resetColumns } from "@/components/data-grid/columns";

export const gridPrefsStorageKey = (ctx: FieldContext) => `leadfinder.grid.${ctx}`;

export type ResolvedGridPrefs = {
  columns: FieldKey[];
  pageSize: GridPageSize | undefined;
  source: "session" | "server" | "local" | "default";
};

/** Parse this browser's saved copy (a JSON GridContextPrefs) leniently; null if absent/invalid. */
export function parseLocalGridPrefs(raw: string | null | undefined, ctx: FieldContext): GridContextPrefs | null {
  if (!raw) return null;
  try {
    return parseStoredGridPrefs({ [ctx]: JSON.parse(raw) as unknown })[ctx] ?? null;
  } catch {
    return null;
  }
}

export function resolveGridPrefs(input: {
  context: FieldContext;
  session?: GridContextPrefs | null;
  server?: GridContextPrefs | null;
  local?: GridContextPrefs | null;
}): ResolvedGridPrefs {
  const { context } = input;
  const pick = (p: GridContextPrefs, source: ResolvedGridPrefs["source"]): ResolvedGridPrefs => ({
    columns: normalizeColumns(p.columns, context),
    pageSize: p.pageSize,
    source,
  });
  if (input.session) return pick(input.session, "session");
  if (input.server) return pick(input.server, "server");
  if (input.local) return pick(input.local, "local");
  return { columns: resetColumns(context), pageSize: undefined, source: "default" };
}
