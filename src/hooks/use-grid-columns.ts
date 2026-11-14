"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { FieldContext, FieldKey } from "@/lib/fields";
import { parseStoredGridPrefs, type GridContextPrefs, type GridPageSize, type GridPrefs, type GridPrefsPatch } from "@/lib/grid-prefs";
import { normalizeColumns, resetColumns as defaultLayout } from "@/components/data-grid/columns";
import { gridPrefsStorageKey, parseLocalGridPrefs, resolveGridPrefs, type ResolvedGridPrefs } from "./grid-prefs-state";

export const GRID_PREFS_ENDPOINT = "/api/v1/me/grid-prefs";
export const GRID_PREFS_QUERY_KEY = ["me", "grid-prefs"] as const;
const LOCAL_EVENT = "leadfinder:grid-prefs";

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, prefs: GridContextPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
    window.dispatchEvent(new Event(LOCAL_EVENT));
  } catch {
    // storage full / disabled: the in-memory state still applies for this session
  }
}

function subscribeLocal(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

export type GridColumnsState = {
  /** Visible columns in display order (business_name always first). */
  columns: FieldKey[];
  setColumns: (cols: FieldKey[]) => void;
  resetColumns: () => void;
  /** Saved page size, if the user picked one. Pass it to useListQueryState's defaults. */
  pageSize: GridPageSize | undefined;
  setPageSize: (size: GridPageSize) => void;
  /** True once the server answered (or failed) — use it to avoid a layout flash if you care. */
  ready: boolean;
  source: ResolvedGridPrefs["source"];
};

/**
 * Visible columns + page size for a grid, saved per user via GET/PUT /api/v1/me/grid-prefs.
 * When the endpoint is unavailable the layout is kept in this browser (localStorage key
 * `leadfinder.grid.<context>`) without bothering the user. Defaults to `defaultColumns(context)`.
 */
export function useGridColumns(context: FieldContext, options: { saveDelayMs?: number } = {}): GridColumnsState {
  const saveDelayMs = options.saveDelayMs ?? 600;
  const qc = useQueryClient();
  const storageKey = gridPrefsStorageKey(context);

  const server = useQuery({
    queryKey: GRID_PREFS_QUERY_KEY,
    queryFn: async () => parseStoredGridPrefs(await api<unknown>(GRID_PREFS_ENDPOINT)),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const rawLocal = React.useSyncExternalStore(
    subscribeLocal,
    () => readLocal(storageKey),
    () => null,
  );
  const local = React.useMemo(() => parseLocalGridPrefs(rawLocal, context), [rawLocal, context]);

  const [session, setSession] = React.useState<GridContextPrefs | null>(null);
  const resolved = resolveGridPrefs({ context, session, server: server.data?.[context] ?? null, local });

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = React.useRef<GridContextPrefs | null>(null);

  const flush = React.useCallback(
    (keepalive = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const prefs = queued.current;
      queued.current = null;
      if (!prefs) return;
      const body: GridPrefsPatch = { [context]: prefs };
      api<unknown>(GRID_PREFS_ENDPOINT, { method: "PUT", json: body, keepalive })
        .then((res) => {
          const parsed = parseStoredGridPrefs(res);
          qc.setQueryData<GridPrefs>(GRID_PREFS_QUERY_KEY, (old) => (parsed[context] ? parsed : { ...(old ?? {}), [context]: prefs }));
        })
        .catch(() => {
          // Saved locally already; the server copy will catch up on the next successful save.
        });
    },
    [context, qc],
  );

  React.useEffect(() => () => flush(true), [flush]);

  const save = React.useCallback(
    (prefs: GridContextPrefs) => {
      setSession(prefs);
      writeLocal(storageKey, prefs);
      queued.current = prefs;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), saveDelayMs);
    },
    [flush, saveDelayMs, storageKey],
  );

  const { columns, pageSize, source } = resolved;
  const setColumns = React.useCallback(
    (cols: FieldKey[]) => save({ columns: normalizeColumns(cols, context), ...(pageSize ? { pageSize } : {}) }),
    [context, pageSize, save],
  );
  const resetColumns = React.useCallback(() => setColumns(defaultLayout(context)), [context, setColumns]);
  const setPageSize = React.useCallback((size: GridPageSize) => save({ columns, pageSize: size }), [columns, save]);

  return { columns, setColumns, resetColumns, pageSize, setPageSize, ready: server.isFetched || session !== null, source };
}
