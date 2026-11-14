/**
 * Homepage concept contracts: generation input, stored content and the JSON shapes of /api/v1/concepts.
 *
 * Pure module (zod only — no DB, no secrets) so client components can `import type` from it and the
 * renderer, template and post-checks can be unit tested.
 */
import { z } from "zod";

/* ───────────────────────────── Vocabulary ───────────────────────────── */

export const CONCEPT_STYLES = ["modern", "minimal", "elegant", "bold", "playful", "natural"] as const;
export type ConceptStyle = (typeof CONCEPT_STYLES)[number];

export const CONCEPT_TONES = ["professional", "friendly", "luxury", "energetic"] as const;
export type ConceptTone = (typeof CONCEPT_TONES)[number];

/** Homepage sections in their default order. */
export const CONCEPT_SECTIONS = ["hero", "services", "about", "highlights", "gallery", "testimonials", "contact"] as const;
export type ConceptSection = (typeof CONCEPT_SECTIONS)[number];

export const TYPOGRAPHY_PAIRINGS = ["modern-sans", "elegant-serif", "friendly-rounded", "classic"] as const;
export type TypographyPairing = (typeof TYPOGRAPHY_PAIRINGS)[number];

export const CONCEPT_LANGUAGES = ["en", "fr"] as const;
export type ConceptLanguage = (typeof CONCEPT_LANGUAGES)[number];

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────────── Small helpers ───────────────────────────── */

// Control and invisible characters never belong in page copy.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏  ‪-‮⁦-⁩﻿]/g;

/** Remove control characters and collapse runs of spaces/tabs (newlines kept for multi-line bodies). */
export function cleanCopy(s: string): string {
  return s
    .replace(CONTROL_RE, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*\n\s*/g, "\n\n")
    .trim();
}

/** Required text: cleaned, 1..max characters. */
const reqText = (max: number) =>
  z
    .string()
    .transform(cleanCopy)
    .pipe(z.string().min(1, "Required").max(max, `At most ${max} characters`));

/** Text that may be empty (the renderer leaves an empty field out). */
const optText = (max: number) =>
  z
    .string()
    .transform(cleanCopy)
    .pipe(z.string().max(max, `At most ${max} characters`));

/** Optional form field: "" / null / whitespace → undefined. */
const optField = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? cleanCopy(v) || undefined : undefined))
    .pipe(z.string().max(max, `At most ${max} characters`).optional());

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_RE, "Use a colour like #1a73e8")
  .transform((v) => v.toLowerCase());

/* ───────────────────────────── Content (stored + editable) ───────────────────────────── */

export const CONTENT_LIMITS = {
  siteTitle: 80,
  tagline: 140,
  headline: 120,
  subheadline: 280,
  cta: 40,
  heading: 80,
  aboutBody: 1200,
  itemTitle: 80,
  serviceDescription: 300,
  highlightDescription: 240,
  testimonialsNote: 400,
  galleryIdea: 120,
  contactBody: 400,
  seoTitle: 60,
  seoDescription: 160,
  maxServices: 8,
  maxHighlights: 4,
  maxGalleryIdeas: 6,
} as const;

const L = CONTENT_LIMITS;

export const paletteSchema = z.object({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  accent: hexColorSchema,
  background: hexColorSchema,
  surface: hexColorSchema,
  text: hexColorSchema,
});
export type ConceptPalette = z.infer<typeof paletteSchema>;
export const PALETTE_KEYS = ["primary", "secondary", "accent", "background", "surface", "text"] as const satisfies readonly (keyof ConceptPalette)[];

const sectionsSchema = z
  .array(z.enum(CONCEPT_SECTIONS))
  .min(1, "Choose at least one section")
  .max(CONCEPT_SECTIONS.length)
  .transform((s) => [...new Set(s)]);

/** The homepage copy and design tokens. Validated on every write (AI output, template, user edits). */
export const conceptContentSchema = z.object({
  siteTitle: reqText(L.siteTitle),
  tagline: optText(L.tagline),
  hero: z.object({
    headline: reqText(L.headline),
    subheadline: optText(L.subheadline),
    primaryCta: reqText(L.cta),
    secondaryCta: optField(L.cta),
  }),
  about: z.object({ heading: optText(L.heading), body: optText(L.aboutBody) }),
  services: z
    .array(z.object({ title: reqText(L.itemTitle), description: optText(L.serviceDescription) }))
    .min(1, "Add at least one service")
    .max(L.maxServices),
  /** Qualitative strengths only — never statistics, years, awards or prices. */
  highlights: z.array(z.object({ title: reqText(L.itemTitle), description: optText(L.highlightDescription) })).max(L.maxHighlights),
  /** Guidance for the business owner (e.g. "add 2–3 real reviews"); never invented quotes. */
  testimonialsNote: optText(L.testimonialsNote),
  gallery: z.object({ ideas: z.array(reqText(L.galleryIdea)).max(L.maxGalleryIdeas) }),
  contact: z.object({ heading: optText(L.heading), body: optText(L.contactBody) }),
  palette: paletteSchema,
  typography: z.object({ pairing: z.enum(TYPOGRAPHY_PAIRINGS) }),
  seo: z.object({ title: reqText(L.seoTitle), metaDescription: optText(L.seoDescription) }),
  sections: sectionsSchema,
});
export type ConceptContent = z.infer<typeof conceptContentSchema>;

/* ───────────────────────────── Generation input ───────────────────────────── */

export const conceptRefSchema = z.object({
  kind: z.enum(["result", "lead"]),
  id: z.string().regex(UUID_RE, "Invalid id"),
});
export type ConceptRef = z.infer<typeof conceptRefSchema>;

/** https Google Maps links only (any Google country domain, maps.app.goo.gl, goo.gl/maps). */
export function isGoogleMapsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl") return path.startsWith("/maps");
  const google = /^(?:www\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;
  if (/^maps\.google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) return true;
  return google.test(host) && (path === "/maps" || path.startsWith("/maps/") || path.startsWith("/maps?"));
}

const PHONE_RE = /^\+?[0-9 ().-]{4,40}$/;
export const digitsOf = (s: string) => s.replace(/\D/g, "");

const phoneField = optField(40).refine((v) => v === undefined || (PHONE_RE.test(v) && digitsOf(v).length >= 6), {
  message: "Use digits, spaces and an optional leading + (e.g. +228 90 12 34 56)",
});

/**
 * Contact details shown on the concept. Pre-filled from the business in the UI, then confirmed or
 * edited by the user — stored as the user's own content.
 */
export const conceptContactSchema = z.object({
  businessName: reqText(120),
  phone: phoneField,
  whatsapp: phoneField,
  email: optField(254).refine((v) => v === undefined || z.email().safeParse(v).success, { message: "Enter a valid email address" }),
  address: optField(240),
  city: optField(80),
  mapsUrl: optField(2048).refine((v) => v === undefined || isGoogleMapsUrl(v), { message: "Use an https Google Maps link" }),
});
export type ConceptContact = z.infer<typeof conceptContactSchema>;
/** What a client may send for the contact block (empty strings and nulls are accepted and dropped). */
export type ConceptContactInput = z.input<typeof conceptContactSchema>;

const conceptOptionsShape = {
  services: z
    .array(z.string().transform(cleanCopy).pipe(z.string().max(80, "Each service: at most 80 characters")))
    .transform((s) => {
      const seen = new Set<string>();
      return s.filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
    })
    .pipe(z.array(z.string()).min(1, "List at least one service").max(12, "At most 12 services")),
  style: z.enum(CONCEPT_STYLES),
  tone: z.enum(CONCEPT_TONES),
  primaryColor: z
    .union([hexColorSchema, z.literal(""), z.null()])
    .optional()
    .transform((v) => v || undefined),
  language: z.enum(CONCEPT_LANGUAGES),
  sections: sectionsSchema.optional(),
  notes: optField(1000),
  /** Kind of business in the user's words (pre-filled from the listing category). */
  businessType: optField(80),
  contact: conceptContactSchema,
};

/** Everything the generator uses. Stored in concepts.input (with the ref). */
export const conceptInputSchema = z.object({ ref: conceptRefSchema, ...conceptOptionsShape });
export type ConceptInput = z.infer<typeof conceptInputSchema>;
export type ConceptInputBody = z.input<typeof conceptInputSchema>;

/** POST /api/v1/concepts body. `useAi: false` forces the template even when AI is configured. */
export const createConceptSchema = conceptInputSchema.extend({ useAi: z.boolean().optional() });
export type CreateConceptBody = z.input<typeof createConceptSchema>;

/** The editable part of the input (the ref is fixed once the concept exists). */
export const conceptOptionsSchema = z.object(conceptOptionsShape);
export type ConceptOptions = z.infer<typeof conceptOptionsSchema>;
export type ConceptOptionsBody = z.input<typeof conceptOptionsSchema>;

/** POST /api/v1/concepts/{id}/regenerate body (all optional: without `input` the saved input is reused). */
export const regenerateConceptSchema = z.object({ input: conceptOptionsSchema.optional(), useAi: z.boolean().optional() });
export type RegenerateConceptBody = z.input<typeof regenerateConceptSchema>;

/** PATCH /api/v1/concepts/{id} body. */
export const updateConceptSchema = z
  .object({
    content: conceptContentSchema.optional(),
    input: conceptOptionsSchema.optional(),
    shareEnabled: z.boolean().optional(),
  })
  .refine((v) => v.content !== undefined || v.input !== undefined || v.shareEnabled !== undefined, { message: "Nothing to update" });
export type UpdateConceptBody = z.input<typeof updateConceptSchema>;

export const prefillQuerySchema = z.object({ ref_kind: z.enum(["result", "lead"]), ref_id: z.string().regex(UUID_RE, "Invalid id") });

/* ───────────────────────────── API shapes ───────────────────────────── */

export type ConceptSummaryDto = {
  id: string;
  businessName: string;
  ref: ConceptRef | null;
  style: ConceptStyle | null;
  tone: ConceptTone | null;
  language: ConceptLanguage;
  generatedBy: "template" | "ai";
  shareEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConceptDto = ConceptSummaryDto & {
  /** The saved generation input; null only for rows whose input no longer validates. */
  input: ConceptInput | null;
  content: ConceptContent;
  model: string | null;
  /** "/c/<token>" when sharing is on (the client prefixes window.location.origin). */
  sharePath: string | null;
};

/** POST /api/v1/concepts (201) and POST /api/v1/concepts/{id}/regenerate. */
export type ConceptGenerateResponse = ConceptDto & { warnings: string[] };

export type ConceptListResponse = { concepts: ConceptSummaryDto[] };

/** GET /api/v1/concepts/prefill?ref_kind&ref_id */
export type ConceptPrefillDto = {
  ref: ConceptRef;
  /** Suggested contact block — the user confirms or edits it before generating. */
  contact: {
    businessName: string;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    mapsUrl: string | null;
  };
  businessType: string | null;
  city: string | null;
  hasWebsite: boolean;
  website: string | null;
  /** Shown next to pre-filled values (e.g. "Data from Google Maps"). */
  attribution: string | null;
  isSample: boolean;
  /** Language from the user's settings. */
  defaultLanguage: ConceptLanguage;
};
