// CONTRACT STUB — implemented by the "proposals" module agent. Keep these export signatures.
import "server-only";
import type { z } from "zod";
import type { AppUser } from "../auth/session";

export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: "not_configured" | "limit_reached" | "failed"; message: string };

/** True when AI_GATEWAY_API_KEY is set. */
export function isAiAvailable(): boolean {
  return false;
}

/**
 * Structured generation through the Vercel AI Gateway (AI SDK generateText + Output.object).
 * Enforces AI_DAILY_LIMIT_PER_USER and records usage as operation `ai_<operation>`.
 * `untrustedData` is serialized inside a delimited block and must be treated as data, not instructions.
 */
export async function generateStructured<S extends z.ZodType>(_opts: {
  user: AppUser;
  operation: "proposal" | "concept" | "classify";
  schema: S;
  system: string;
  instructions: string;
  untrustedData?: unknown;
  maxOutputTokens?: number;
}): Promise<AiResult<z.infer<S>>> {
  return { ok: false, reason: "not_configured", message: "AI is not configured" };
}
