"use client";
import * as React from "react";

/** Debounce a value (stable for objects via JSON comparison). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = React.useState(value);
  const key = JSON.stringify(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs]);
  return v;
}
