import "server-only";
import { createGateway, generateText, JSONParseError, NoObjectGeneratedError, Output, TypeValidationError, type LanguageModel } from "ai";
import type { z } from "zod";
import type { AppUser } from "../auth/session";
import { env } from "../env";
import { operationsLast24h, recordUsage } from "../usage";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";

export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: "not_configured" | "limit_reached" | "failed"; message: string };

export type AiOperation = "proposal" | "concept" | "classify";

export type GenerateStructuredDeps = {
  /** Use this model instead of the AI Gateway (tests pass a mock model from "ai/test"). */
  model?: LanguageModel;
  /** Override the 45 s timeout (tests). */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;

export const AI_MESSAGES = {
  notConfigured: "AI isn't configured — add an AI Gateway key to enable it.",
  limitReached: (limit: number) =>
    `You've used all ${limit} AI generations for today. The limit resets within 24 hours — templates keep working in the meantime.`,
  timeout: "The AI took too long to answer. Please try again in a moment.",
  invalidOutput: "The AI's answer wasn't in the expected format. Please try again.",
  providerError: "The AI service couldn't be reached right now. Please try again in a moment.",
} as const;

/** True when AI_GATEWAY_API_KEY is set. */
export function isAiAvailable(): boolean {
  return Boolean(env().AI_GATEWAY_API_KEY);
}

const modelName = (m: LanguageModel): string => (typeof m === "string" ? m : m.modelId);

function resolveModel(deps?: GenerateStructuredDeps): LanguageModel | null {
  if (deps?.model) return deps.model;
  if (!isAiAvailable()) return null;
  const gateway = createGateway({ apiKey: env().AI_GATEWAY_API_KEY });
  return gateway(env().AI_MODEL);
}

/** Output arrived but failed our own schema check. */
class InvalidAiOutputError extends Error {
  override name = "InvalidAiOutputError";
}

function isTimeout(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

/** Maps any failure to a short, user-facing message. Never includes prompt content. */
function failureMessage(e: unknown, signal: AbortSignal): string {
  if (isTimeout(e, signal)) return AI_MESSAGES.timeout;
  if (
    e instanceof InvalidAiOutputError ||
    NoObjectGeneratedError.isInstance(e) ||
    TypeValidationError.isInstance(e) ||
    JSONParseError.isInstance(e) ||
    (e instanceof Error && e.name === "AI_NoOutputGeneratedError")
  ) {
    return AI_MESSAGES.invalidOutput;
  }
  // Connection, authentication, rate limit or retry exhaustion at the gateway.
  return AI_MESSAGES.providerError;
}

/**
 * Structured generation through the Vercel AI Gateway (AI SDK generateText + Output.object).
 * Enforces AI_DAILY_LIMIT_PER_USER and records usage as operation `ai_<operation>`.
 * `untrustedData` is serialized inside a delimited block and must be treated as data, not instructions.
 */
export async function generateStructured<S extends z.ZodType>(
  opts: {
    user: AppUser;
    operation: AiOperation;
    schema: S;
    system: string;
    instructions: string;
    untrustedData?: unknown;
    maxOutputTokens?: number;
  },
  deps?: GenerateStructuredDeps,
): Promise<AiResult<z.infer<S>>> {
  const model = resolveModel(deps);
  if (!model) return { ok: false, reason: "not_configured", message: AI_MESSAGES.notConfigured };

  const limit = env().AI_DAILY_LIMIT_PER_USER;
  const used = await operationsLast24h(opts.user.id, "ai_");
  if (used >= limit) return { ok: false, reason: "limit_reached", message: AI_MESSAGES.limitReached(limit) };

  const signal = AbortSignal.timeout(deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const usage = { userId: opts.user.id, provider: "ai_gateway", operation: `ai_${opts.operation}`, billable: true, estimatedCostUsd: 0 };

  let data: z.infer<S>;
  try {
    const result = await generateText({
      model,
      instructions: buildSystemPrompt(opts.system),
      prompt: buildUserPrompt(opts.instructions, opts.untrustedData),
      output: Output.object({ schema: opts.schema }),
      maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      abortSignal: signal,
      maxRetries: 1,
    });
    // The SDK validates against the schema already; parse again so transforms/refinements always apply.
    const parsed = opts.schema.safeParse(result.output);
    if (!parsed.success) throw new InvalidAiOutputError("AI output failed schema validation");
    data = parsed.data;
  } catch (e) {
    await recordUsage(usage).catch(() => undefined);
    // Log only the operation and error class — prompts may contain personal data.
    console.warn(`[ai] ${opts.operation} generation failed (${e instanceof Error ? e.name : "unknown error"})`);
    return { ok: false, reason: "failed", message: failureMessage(e, signal) };
  }

  await recordUsage(usage).catch((e: unknown) => console.error("[ai] failed to record usage", e instanceof Error ? e.message : e));
  return { ok: true, data, model: modelName(model) };
}
