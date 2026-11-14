import "server-only";
import { z } from "zod";
import type { Language } from "@/lib/domain";
import type { AppUser } from "../auth/session";
import { generateStructured, type GenerateStructuredDeps } from "../ai/gateway";
import { checkAiRewrite } from "./ai-guard";

export const polishSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2500),
});

const LANGUAGE_NAME: Record<Language, string> = { en: "English", fr: "French" };

export const AI_FALLBACK_WARNING = "The AI version changed or added details, so the template version is shown instead.";

export type PolishResult = { ok: true; subject: string; body: string } | { ok: false; warning: string };

/**
 * Ask the AI to rewrite a template draft so it sounds more personal. The draft (which contains
 * provider data such as the business name) is passed only as untrusted data.
 */
export async function polishDraft(
  user: AppUser,
  draft: { subject: string; body: string; language: Language; factsUsed: Record<string, string | number | null>; signatureLines: string[] },
  deps?: GenerateStructuredDeps,
): Promise<PolishResult> {
  const lang = LANGUAGE_NAME[draft.language];
  const res = await generateStructured(
    {
      user,
      operation: "proposal",
      schema: polishSchema,
      system: [
        "You edit short outreach messages that a freelance web designer sends to local small businesses.",
        `You write natural, warm, professional ${lang}${draft.language === "fr" ? " using vouvoiement (vous), with gender-neutral wording" : ""}.`,
      ].join(" "),
      instructions: [
        `Rewrite the draft message in the DATA block (fields "draft.subject" and "draft.body") so it reads more personal and natural in ${lang}.`,
        "Rules:",
        "- Keep every fact from the draft (business name, category, city, rating, review count, website observations, links). Do not add any new fact, number, link or claim.",
        "- Keep the closing and the signature lines at the end exactly as written, on their own lines.",
        "- Keep links and contact details exactly as written.",
        "- At most 180 words before the closing. Plain text only: no Markdown, no placeholders, no emojis.",
        "- The subject must be at most 120 characters.",
      ].join("\n"),
      untrustedData: { draft: { subject: draft.subject, body: draft.body }, facts: draft.factsUsed, language: draft.language },
      maxOutputTokens: 1500,
    },
    deps,
  );
  if (!res.ok) {
    return { ok: false, warning: res.reason === "not_configured" ? res.message : `${res.message} The template version is shown instead.` };
  }
  const check = checkAiRewrite(draft, res.data, draft.signatureLines);
  if (!check.ok) return { ok: false, warning: AI_FALLBACK_WARNING };
  return { ok: true, subject: res.data.subject, body: res.data.body };
}
