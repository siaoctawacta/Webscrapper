import { NextRequest } from "next/server";
import type { TestUser } from "./auth";

/** Build a NextRequest for calling a route handler directly in tests. */
export function apiRequest(
  path: string,
  opts: { method?: string; body?: unknown; user?: TestUser; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(opts.headers);
  headers.set("origin", "http://localhost:3000");
  headers.set("host", "localhost:3000");
  if (opts.user) headers.set("cookie", opts.user.cookie);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** Route handler context with already-known params. */
export const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
