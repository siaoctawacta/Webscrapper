"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FieldContext } from "@/lib/fields";
import type { ListQuery } from "@/lib/list-query";
import { applyQueryPatch } from "@/components/data-grid/query";
import { readListQuery, resolveDefaults, sameListQuery, writeListQuery } from "./list-query-url";

export type ListQueryStateOptions = {
  /** Applied when the URL has no list params (first visit) and as fallback for invalid params. */
  defaults?: Partial<ListQuery>;
  /**
   * How the URL is updated:
   *  - "history" (default): `window.history.replaceState` — Next.js keeps `useSearchParams` in
   *    sync and no server round-trip happens (best for client-fetched grids);
   *  - "router": `router.replace(href, { scroll: false })` — also re-renders server components
   *    that read `searchParams`.
   */
  strategy?: "history" | "router";
};

export type ListQueryState = {
  query: ListQuery;
  /** Replace the query (value or updater). Writes the URL; never adds a history entry. */
  setQuery: (next: ListQuery | ((prev: ListQuery) => ListQuery)) => void;
  /** Merge a change; resets to page 1 when sort/filters/search/page size change. */
  patchQuery: (patch: Partial<ListQuery>) => void;
  /** Back to the defaults (clears list params from the URL). */
  resetQuery: () => void;
  defaults: ListQuery;
};

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Keeps a grid's ListQuery (page, page size, sort, filters, search) in the URL so views are
 * shareable and survive reloads. Unrelated params are preserved.
 *
 * Uses `useSearchParams`, so the component calling it must sit under a `<Suspense>` boundary.
 *
 * @example
 *   const { query, setQuery } = useListQueryState("results", { defaults: { pageSize: prefs.pageSize } });
 *   <DataGrid query={query} onQueryChange={setQuery} … />
 */
export function useListQueryState(context: FieldContext, options: ListQueryStateOptions = {}): ListQueryState {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const strategy = options.strategy ?? "history";

  const defaultsKey = JSON.stringify(options.defaults ?? null);
  const defaults = React.useMemo(() => resolveDefaults(JSON.parse(defaultsKey) as Partial<ListQuery> | null ?? undefined), [defaultsKey]);

  const urlString = searchParams.toString();
  const fromUrl = React.useMemo(() => readListQuery(new URLSearchParams(urlString), context, defaults), [urlString, context, defaults]);

  // Optimistic value shown until the URL change lands (keeps clicks instant, esp. with "router").
  const [pending, setPending] = React.useState<{ base: string; query: ListQuery } | null>(null);
  const query = pending && pending.base === urlString ? pending.query : fromUrl;

  const latest = React.useRef(query);
  const urlRef = React.useRef(urlString);
  useIsoLayoutEffect(() => {
    latest.current = query;
    urlRef.current = urlString;
  });

  const write = React.useCallback(
    (next: ListQuery) => {
      const current = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams(urlRef.current);
      const qs = writeListQuery(current, next, defaults).toString();
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const href = `${pathname}${qs ? `?${qs}` : ""}${hash}`;
      if (strategy === "router" || typeof window === "undefined") router.replace(href, { scroll: false });
      // `null` state lets Next.js copy its own router state and sync useSearchParams.
      else window.history.replaceState(null, "", href);
    },
    [defaults, pathname, router, strategy],
  );

  const setQuery = React.useCallback<ListQueryState["setQuery"]>(
    (nextOrFn) => {
      const prev = latest.current;
      const next = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
      if (sameListQuery(prev, next)) return;
      latest.current = next;
      setPending({ base: urlRef.current, query: next });
      write(next);
    },
    [write],
  );

  const patchQuery = React.useCallback((patch: Partial<ListQuery>) => setQuery((prev) => applyQueryPatch(prev, patch)), [setQuery]);
  const resetQuery = React.useCallback(() => setQuery(defaults), [setQuery, defaults]);

  return { query, setQuery, patchQuery, resetQuery, defaults };
}
