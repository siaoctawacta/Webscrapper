import type { ConceptLanguage, ConceptSection, ConceptStyle, ConceptTone } from "@/server/concepts/schema";

/** Labels for the concept form. Typed against the server schema so a new option can't be forgotten. */
export const STYLE_OPTIONS: Record<ConceptStyle, { label: string; description: string }> = {
  modern: { label: "Modern", description: "Clean sans-serif, bright blue accents" },
  minimal: { label: "Minimal", description: "Black and white, lots of space" },
  elegant: { label: "Elegant", description: "Serif headings, warm neutrals" },
  bold: { label: "Bold", description: "Strong colour, high contrast" },
  playful: { label: "Playful", description: "Rounded type, cheerful colours" },
  natural: { label: "Natural", description: "Earthy greens, classic type" },
};

export const TONE_OPTIONS: Record<ConceptTone, { label: string; description: string }> = {
  professional: { label: "Professional", description: "Clear and reassuring" },
  friendly: { label: "Friendly", description: "Warm and personal" },
  luxury: { label: "Premium", description: "Calm, refined, attentive" },
  energetic: { label: "Energetic", description: "Upbeat, action-oriented" },
};

export const SECTION_OPTIONS: Record<ConceptSection, { label: string; description: string }> = {
  hero: { label: "Hero", description: "Headline and call-to-action buttons" },
  services: { label: "Services", description: "One card per service" },
  about: { label: "About", description: "A short introduction" },
  highlights: { label: "Highlights", description: "Why choose this business" },
  gallery: { label: "Gallery", description: "Photo ideas as placeholders" },
  testimonials: { label: "Reviews", description: "Placeholder for real reviews" },
  contact: { label: "Contact", description: "Phone, WhatsApp, email, map" },
};

export const SECTION_ORDER = Object.keys(SECTION_OPTIONS) as ConceptSection[];
export const STYLE_KEYS = Object.keys(STYLE_OPTIONS) as ConceptStyle[];
export const TONE_KEYS = Object.keys(TONE_OPTIONS) as ConceptTone[];

export const LANGUAGE_OPTIONS: Record<ConceptLanguage, string> = { en: "English", fr: "Français" };
