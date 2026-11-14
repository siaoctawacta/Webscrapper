"use client";
import type { ApiError } from "./api-types";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: ApiError["error"]["code"] | "network",
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Typed fetch for /api/v1. Throws ApiClientError with the server's message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError(0, "network", "Network error — check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as ApiError | undefined)?.error;
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/sign-in";
    throw new ApiClientError(res.status, err?.code ?? "internal", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}
