/**
 * Visible-column helpers (pure). The grid always shows `business_name` first (it is sticky on the
 * left); every other column can be hidden and reordered.
 */
import { defaultColumns, fieldsFor, isFieldKey, type FieldContext, type FieldKey } from "@/lib/fields";

export const PINNED_COLUMN: FieldKey = "business_name";

/** Keep only known, allowed, unique keys; make sure the pinned column is present and first. */
export function normalizeColumns(cols: readonly unknown[] | null | undefined, ctx: FieldContext): FieldKey[] {
  const allowed = new Set<FieldKey>(fieldsFor(ctx));
  const seen = new Set<FieldKey>();
  const out: FieldKey[] = [];
  for (const c of cols ?? []) {
    if (typeof c !== "string" || !isFieldKey(c) || !allowed.has(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  const rest = out.filter((c) => c !== PINNED_COLUMN);
  return [PINNED_COLUMN, ...rest];
}

export const resetColumns = (ctx: FieldContext): FieldKey[] => normalizeColumns(defaultColumns(ctx), ctx);

/**
 * Show or hide a column. A newly shown column is inserted after the closest visible column that
 * precedes it in the field registry, so it lands somewhere sensible even after reordering.
 */
export function toggleColumn(cols: readonly FieldKey[], key: FieldKey, ctx: FieldContext): FieldKey[] {
  if (key === PINNED_COLUMN) return [...cols];
  if (cols.includes(key)) return cols.filter((c) => c !== key);
  const registry = fieldsFor(ctx);
  const at = registry.indexOf(key);
  if (at === -1) return [...cols];
  let insertAfter = 0;
  for (let i = at - 1; i >= 0; i--) {
    const idx = cols.indexOf(registry[i]!);
    if (idx !== -1) {
      insertAfter = idx;
      break;
    }
  }
  return [...cols.slice(0, insertAfter + 1), key, ...cols.slice(insertAfter + 1)];
}

export const canMoveColumn = (cols: readonly FieldKey[], key: FieldKey, delta: -1 | 1): boolean => {
  const i = cols.indexOf(key);
  if (i <= 0) return false; // missing, or the pinned column
  const j = i + delta;
  return j >= 1 && j < cols.length;
};

/** Move a column one step up (-1) or down (+1). The pinned column never moves. */
export function moveColumn(cols: readonly FieldKey[], key: FieldKey, delta: -1 | 1): FieldKey[] {
  if (!canMoveColumn(cols, key, delta)) return [...cols];
  const i = cols.indexOf(key);
  const next = [...cols];
  [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
  return next;
}

/** Columns not currently shown, in registry order. */
export const hiddenColumns = (cols: readonly FieldKey[], ctx: FieldContext): FieldKey[] =>
  fieldsFor(ctx).filter((k) => !cols.includes(k));

export const sameColumns = (a: readonly FieldKey[], b: readonly FieldKey[]) => a.length === b.length && a.every((k, i) => k === b[i]);
