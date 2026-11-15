/**
 * AI side of concept generation, kept pure (no DB, no secrets) so it can be unit tested:
 * the structured-output schema, the prompt, and the post-checks applied to whatever the model returns.
 *
 * The model is told to use only the user's facts. We then verify mechanically what we can:
 *  - sentences / highlights containing numbers that are not in the user's input are removed;
 *  - sentences with unverifiable claims (awards, certifications, guarantees, "number one") are removed;
 *  - the palette must be #rrggbb with text/background and text/surface contrast ≥ 4.5:1, else the style palette;
 *  - sections must be a subset of what the user asked for; the testimonials block is always our own guidance text.
 * Any field emptied by these checks falls back to the deterministic template's copy.
 */
import { z } from "zod";
import { STYLE_TYPOGRAPHY, resolvePalette } from "./design";
import { ctaTarget, type CtaTarget } from "./links";
import {
  CONTENT_LIMITS as L,
  TYPOGRAPHY_PAIRINGS,
  cleanCopy,
  conceptContentSchema,
  type ConceptContent,
  type ConceptOptions,
  type ConceptSection,
  type TypographyPairing,
} from "./schema";
import { clampText, requestedSections } from "./template";

/* ───────────────────────────── Output schema (lenient; post-checked below) ───────────────────────────── */

const s = (max: number) => z.string().max(max);
const item = z.object({ title: s(200), description: s(800) });

export const aiConceptSchema = z.object({
  siteTitle: s(200),
  tagline: s(300),
  hero: z.object({ headline: s(300), subheadline: s(700), primaryCta: s(80), secondaryCta: s(80).optional() }),
  about: z.object({ heading: s(200), body: s(3000) }),
  services: z.array(item).max(12),
  highlights: z.array(item).max(8),
  gallery: z.object({ ideas: z.array(s(300)).max(10) }),
  contact: z.object({ heading: s(200), body: s(1000) }),
  palette: z.object({ primary: s(20), secondary: s(20), accent: s(20), background: s(20), surface: s(20), text: s(20) }),
  typography: z.object({ pairing: s(40) }),
  seo: z.object({ title: s(200), metaDescription: s(400) }),
  sections: z.array(s(40)).max(14),
});
export type AiConceptDraft = z.infer<typeof aiConceptSchema>;

/* ───────────────────────────── Prompt ───────────────────────────── */

const LANGUAGE_NAMES = { en: "English", fr: "French" } as const;

export function conceptSystemPrompt(language: ConceptOptions["language"]): string {
  return [
    "You are a web designer writing homepage copy for a small local business.",
    "Use only the provided facts and the user's services and notes.",
    "Do not invent statistics, numbers, years, opening hours, prices, awards, certifications, guarantees, team sizes, client names or testimonials.",
    "Highlights must be qualitative strengths that follow from the services (no numbers).",
    `Write every piece of copy in ${LANGUAGE_NAMES[language]}. Keep sentences short, concrete and warm; avoid hype and superlatives.`,
  ].join(" ");
}

const CTA_HINT: Record<CtaTarget, string> = {
  whatsapp: "The primary button opens WhatsApp — its label should invite a WhatsApp message.",
  phone: "The primary button starts a phone call — its label should invite a call.",
  contact: "The primary button scrolls to the contact section — its label should invite the visitor to get in touch.",
};

export function conceptInstructions(input: ConceptOptions): string {
  const sections = requestedSections(input);
  return [
    "Write the homepage concept described by the DATA block.",
    `Visual style: ${input.style}. Tone of voice: ${input.tone}.`,
    `Sections to include, in this order: ${sections.join(", ")}.`,
    CTA_HINT[ctaTarget(input.contact)],
    "siteTitle is the business name. tagline: one short line. hero.headline: at most 10 words. hero.subheadline: one or two sentences.",
    `services: one card per listed service (at most ${L.maxServices}); title = the service, description = one sentence about it. Do not add services that are not listed.`,
    `highlights: up to ${Math.min(3, L.maxHighlights)} qualitative strengths. gallery.ideas: up to ${L.maxGalleryIdeas} short descriptions of photos the owner could take.`,
    "contact.body: one sentence inviting visitors to get in touch using the available channels only.",
    `seo.title: at most ${L.seoTitle} characters. seo.metaDescription: at most ${L.seoDescription} characters.`,
    input.primaryColor
      ? `palette: use ${input.primaryColor} as primary and choose the other colours to match. Colours must be #rrggbb; text must contrast strongly with background and surface.`
      : "palette: choose colours that suit the style. Colours must be #rrggbb; text must contrast strongly with background and surface.",
    "typography.pairing: one of modern-sans, elegant-serif, friendly-rounded, classic.",
  ].join("\n");
}

/** Facts the model may use. Everything comes from the user-confirmed form. */
export function conceptPromptData(input: ConceptOptions) {
  const c = input.contact;
  return {
    business: {
      name: c.businessName,
      type: input.businessType ?? null,
      city: c.city ?? null,
      hasAddress: Boolean(c.address),
    },
    services: input.services,
    notesFromUser: input.notes ?? null,
    contactChannels: { phone: Boolean(c.phone), whatsapp: Boolean(c.whatsapp), email: Boolean(c.email) },
    language: input.language,
  };
}

/* ───────────────────────────── Post-checks ───────────────────────────── */

const NUMBER_RE = /\d+/g;
// Claims we can't verify. Letters-only boundaries so accented French words match too.
const CLAIM_RE =
  /(?<![\p{L}\p{N}])(?:award(?:s|ed|-winning)?|prize-winning|certified|accredited|guarantee(?:d|s)?|number one|best-rated|top-rated|primée?s?|certifiée?s?|accréditée?s?|garantie?s?|numéro un)(?![\p{L}\p{N}])|#\s?1(?!\d)|n°\s?1(?!\d)/iu;
const QUOTE_RE = /[“”„«»]/;

const isPairing = (v: unknown): v is TypographyPairing => (TYPOGRAPHY_PAIRINGS as readonly unknown[]).includes(v);

/** Every run of digits that appears anywhere in the user's input. */
export function allowedNumbers(input: ConceptOptions): Set<string> {
  const c = input.contact;
  const text = [
    c.businessName,
    c.phone,
    c.whatsapp,
    c.email,
    c.address,
    c.city,
    input.businessType,
    input.notes,
    ...input.services,
  ]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return new Set(text.match(NUMBER_RE) ?? []);
}

type Checker = { ok: (text: string) => boolean; removed: number };

function checker(allowed: Set<string>): Checker {
  return {
    removed: 0,
    ok(text: string) {
      if (CLAIM_RE.test(text)) return false;
      return (text.match(NUMBER_RE) ?? []).every((n) => allowed.has(n));
    },
  };
}

/** Keep only the sentences that pass; counts removals. */
function filterSentences(text: string, chk: Checker): string {
  const sentences = cleanCopy(text)
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const kept = sentences.filter((sentence) => chk.ok(sentence));
  chk.removed += sentences.length - kept.length;
  return kept.join(" ").trim();
}

/** A short field (title, label): kept whole or replaced by the template's value. */
function shortField(text: string | undefined, fallback: string, max: number, chk: Checker): string {
  const t = cleanCopy(text ?? "");
  if (!t) return fallback;
  if (!chk.ok(t)) {
    chk.removed += 1;
    return fallback;
  }
  return clampText(t, max);
}

/** A sentence field: failing sentences dropped; empty → template value. */
function longField(text: string | undefined, fallback: string, max: number, chk: Checker): string {
  const t = filterSentences(text ?? "", chk);
  return t ? clampText(t, max) : fallback;
}

export type FinalizeResult = { content: ConceptContent; warnings: string[] };

/**
 * Turn the model's draft into valid, policy-checked content. `template` is the deterministic
 * concept for the same input, used for anything that fails a check.
 */
export function finalizeAiContent(draft: AiConceptDraft, input: ConceptOptions, template: ConceptContent): FinalizeResult {
  const chk = checker(allowedNumbers(input));
  const warnings: string[] = [];

  const services = (draft.services ?? [])
    .map((sv) => {
      const title = cleanCopy(sv.title ?? "");
      if (!title || !chk.ok(title)) {
        if (title) chk.removed += 1;
        return null;
      }
      return { title: clampText(title, L.itemTitle), description: clampText(filterSentences(sv.description ?? "", chk), L.serviceDescription) };
    })
    .filter((sv): sv is { title: string; description: string } => sv !== null)
    .slice(0, L.maxServices);

  const highlights = (draft.highlights ?? [])
    .filter((h) => {
      const ok = Boolean(cleanCopy(h.title ?? "")) && chk.ok(`${h.title} ${h.description ?? ""}`);
      if (!ok && cleanCopy(h.title ?? "")) chk.removed += 1;
      return ok;
    })
    .map((h) => ({ title: clampText(cleanCopy(h.title), L.itemTitle), description: clampText(cleanCopy(h.description ?? ""), L.highlightDescription) }))
    .slice(0, L.maxHighlights);

  const ideas = (draft.gallery?.ideas ?? [])
    .map((g) => cleanCopy(g))
    .filter((g) => {
      if (!g) return false;
      if (!chk.ok(g) || QUOTE_RE.test(g)) {
        chk.removed += 1;
        return false;
      }
      return true;
    })
    .map((g) => clampText(g, L.galleryIdea))
    .slice(0, L.maxGalleryIdeas);

  const { palette, fallback } = resolvePalette(draft.palette, input.style, input.primaryColor);
  if (fallback === "invalid") warnings.push(`The AI suggested colours that weren't valid, so the ${input.style} palette was used.`);
  if (fallback === "low_contrast") warnings.push(`The AI's colours didn't give text enough contrast, so the ${input.style} palette was used.`);

  const proposedPairing = draft.typography?.pairing;
  const pairing: TypographyPairing = isPairing(proposedPairing) ? proposedPairing : STYLE_TYPOGRAPHY[input.style];

  const requested = requestedSections(input);
  let sections: ConceptSection[];
  if (input.sections?.length) {
    // The user chose the sections (and their order): the model can't change that.
    sections = requested;
  } else {
    const fromAi = [...new Set(draft.sections ?? [])].filter((x): x is ConceptSection => (requested as string[]).includes(x));
    sections = fromAi.length ? fromAi : requested;
  }

  const secondaryCta = draft.hero?.secondaryCta ? shortField(draft.hero.secondaryCta, template.hero.secondaryCta ?? "", L.cta, chk) : template.hero.secondaryCta;

  const candidate: ConceptContent = {
    siteTitle: shortField(draft.siteTitle, template.siteTitle, L.siteTitle, chk),
    tagline: shortField(draft.tagline, template.tagline, L.tagline, chk),
    hero: {
      headline: shortField(draft.hero?.headline, template.hero.headline, L.headline, chk),
      subheadline: longField(draft.hero?.subheadline, template.hero.subheadline, L.subheadline, chk),
      primaryCta: shortField(draft.hero?.primaryCta, template.hero.primaryCta, L.cta, chk),
      ...(secondaryCta ? { secondaryCta } : {}),
    },
    about: {
      heading: shortField(draft.about?.heading, template.about.heading, L.heading, chk),
      body: longField(draft.about?.body, template.about.body, L.aboutBody, chk),
    },
    services: services.length ? services : template.services,
    highlights,
    // Always our own guidance: the model must never get a chance to write testimonials.
    testimonialsNote: template.testimonialsNote,
    gallery: { ideas: ideas.length ? ideas : template.gallery.ideas },
    contact: {
      heading: shortField(draft.contact?.heading, template.contact.heading, L.heading, chk),
      body: longField(draft.contact?.body, template.contact.body, L.contactBody, chk),
    },
    palette,
    typography: { pairing },
    seo: {
      title: shortField(draft.seo?.title, template.seo.title, L.seoTitle, chk),
      metaDescription: longField(draft.seo?.metaDescription, template.seo.metaDescription, L.seoDescription, chk),
    },
    sections,
  };

  if (chk.removed > 0) {
    warnings.push(
      `Removed ${chk.removed} AI ${chk.removed === 1 ? "sentence" : "sentences"} that mentioned numbers or claims not found in your details.`,
    );
  }

  const parsed = conceptContentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { content: template, warnings: ["The AI's answer couldn't be used, so the template version is shown."] };
  }
  return { content: parsed.data, warnings };
}
