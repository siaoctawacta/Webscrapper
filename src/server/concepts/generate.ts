import "server-only";
import type { AppUser } from "../auth/session";
import { generateStructured, isAiAvailable, type AiResult } from "../ai/gateway";
import { aiConceptSchema, conceptInstructions, conceptPromptData, conceptSystemPrompt, finalizeAiContent, type AiConceptDraft } from "./ai";
import type { ConceptContent, ConceptOptions } from "./schema";
import { buildTemplateContent } from "./template";

/** Options passed to the AI wrapper — same shape as `generateStructured`'s first argument. */
export type ConceptAiRequest = {
  user: AppUser;
  operation: "concept";
  schema: typeof aiConceptSchema;
  system: string;
  instructions: string;
  untrustedData: unknown;
  maxOutputTokens?: number;
};

/** Injected in tests instead of the AI Gateway. Supplying it counts as "AI available". */
export type ConceptAiGenerate = (req: ConceptAiRequest) => Promise<AiResult<AiConceptDraft>>;

export type ContentDeps = {
  generate?: ConceptAiGenerate;
  /** Default: isAiAvailable (AI_GATEWAY_API_KEY set). */
  aiAvailable?: () => boolean;
};

export type GeneratedContent = {
  content: ConceptContent;
  generatedBy: "template" | "ai";
  model: string | null;
  warnings: string[];
};

const defaultGenerate: ConceptAiGenerate = (req) => generateStructured(req);

/**
 * Build concept content: AI when configured and wanted, otherwise (or when the AI fails) the
 * deterministic template. The AI output always goes through `finalizeAiContent` post-checks.
 */
export async function generateConceptContent(
  user: AppUser,
  input: ConceptOptions,
  opts: { useAi?: boolean } = {},
  deps: ContentDeps = {},
): Promise<GeneratedContent> {
  const template = buildTemplateContent(input);
  const wantsAi = opts.useAi !== false;
  const available = deps.generate ? true : (deps.aiAvailable ?? isAiAvailable)();
  if (!wantsAi || !available) return { content: template, generatedBy: "template", model: null, warnings: [] };

  let result: AiResult<AiConceptDraft>;
  try {
    result = await (deps.generate ?? defaultGenerate)({
      user,
      operation: "concept",
      schema: aiConceptSchema,
      system: conceptSystemPrompt(input.language),
      instructions: conceptInstructions(input),
      untrustedData: conceptPromptData(input),
      maxOutputTokens: 3_000,
    });
  } catch (e) {
    console.warn(`[concepts] AI generation threw (${e instanceof Error ? e.name : "unknown error"})`);
    result = { ok: false, reason: "failed", message: "The AI service couldn't be reached right now." };
  }

  if (!result.ok) {
    const msg = result.message.trim();
    return {
      content: template,
      generatedBy: "template",
      model: null,
      warnings: [`${msg}${/[.!?]$/.test(msg) ? "" : "."} Showing the template version instead.`],
    };
  }

  const { content, warnings } = finalizeAiContent(result.data, input, template);
  return { content, generatedBy: "ai", model: result.model, warnings };
}
