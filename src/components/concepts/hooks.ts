"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@/lib/api-types";
import { api } from "@/lib/api-client";

/** Whether the server has AI configured (GET /api/v1/me). False while loading or if the endpoint fails. */
export function useAiAvailable(): { aiAvailable: boolean; loading: boolean } {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/v1/me"),
    staleTime: 60_000,
    retry: false,
  });
  return { aiAvailable: q.data?.aiAvailable === true, loading: q.isLoading };
}

const subscribe = () => () => {};

/** window.location.origin on the client, "" during server rendering. */
export function useOrigin(): string {
  return React.useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
}

/** Width of an element, kept up to date with a ResizeObserver. Pass the returned callback as `ref`. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = React.useState<T | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    if (!el) return;
    // ResizeObserver reports the initial size right after observe().
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}
