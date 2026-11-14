"use client";
import * as React from "react";

/** Returns `value` after it has stopped changing for `delayMs` (default 300 ms). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Debounced callback: calls `fn` once calls have stopped for `delayMs`. `flush()` runs a pending
 * call now, `cancel()` drops it. The latest `fn` is always used.
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs = 300) {
  const fnRef = React.useRef(fn);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<A | null>(null);
  React.useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);
  const flush = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const args = pending.current;
    pending.current = null;
    if (args) fnRef.current(...args);
  }, []);
  const call = React.useCallback(
    (...args: A) => {
      pending.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );
  React.useEffect(() => cancel, [cancel]);
  return { call, flush, cancel };
}
