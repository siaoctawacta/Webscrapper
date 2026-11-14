"use client";
import * as React from "react";
import { formatDate, formatRelative } from "@/lib/utils";

const subscribe = () => () => {};

/** False during server render and hydration, true afterwards (avoids time-zone hydration mismatches). */
export function useHydrated() {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * A date shown in the viewer's time zone. The server render uses UTC and the client replaces it after
 * hydration, so server and client markup always match.
 */
export function TimeText({
  iso,
  mode = "date",
  empty = "—",
  className,
}: {
  iso: string | null | undefined;
  mode?: "date" | "datetime" | "relative";
  empty?: string;
  className?: string;
}) {
  const hydrated = useHydrated();
  if (!iso) return <span className={className}>{empty}</span>;
  const tz = hydrated ? undefined : "UTC";
  const full = formatDate(iso, { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const text =
    mode === "relative"
      ? hydrated
        ? formatRelative(iso)
        : formatDate(iso, { dateStyle: "medium", timeZone: "UTC" })
      : mode === "datetime"
        ? full
        : formatDate(iso, { dateStyle: "medium", timeZone: tz });
  return (
    <time dateTime={iso} title={full} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
