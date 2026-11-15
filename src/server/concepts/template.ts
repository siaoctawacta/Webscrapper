/**
 * Deterministic homepage copy (no AI) in English and French, built only from what the user entered:
 * business name, type, city, services and contact channels. Pure module.
 *
 * Nothing is invented: no numbers, years, prices, awards or testimonials — the testimonials block is
 * guidance for the owner, clearly marked as a placeholder.
 */
import { STYLE_TYPOGRAPHY, stylePalette } from "./design";
import { ctaTarget, mailtoHref, telHref, whatsappHref, type CtaTarget } from "./links";
import {
  CONCEPT_SECTIONS,
  CONTENT_LIMITS as L,
  conceptContentSchema,
  type ConceptContent,
  type ConceptLanguage,
  type ConceptOptions,
  type ConceptSection,
  type ConceptTone,
} from "./schema";

/* ───────────────────────────── Text helpers ───────────────────────────── */

/** Cut at a word boundary and add "…" when longer than `max`. */
export function clampText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?·—–-]+$/, "")}…`;
}

export const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/** "Wedding photography" → "wedding photography" for use mid-sentence; acronyms/brands ("SEO", "iPhone") are kept. */
export function inSentence(s: string): string {
  if (s.length > 1 && s.charAt(1) === s.charAt(1).toLocaleUpperCase() && s.charAt(1) !== s.charAt(1).toLocaleLowerCase()) return s;
  return s.charAt(0).toLocaleLowerCase() + s.slice(1);
}

export function joinList(items: string[], lang: ConceptLanguage, conj?: string): string {
  const and = conj ?? (lang === "fr" ? "et" : "and");
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/* ───────────────────────────── Copy ───────────────────────────── */

type Ctx = {
  name: string;
  /** Business type or first services, as a capitalised phrase ("Hotel and restaurant"). */
  phrase: string;
  city: string | null;
  services: string[];
  /** Services for use inside a sentence. */
  lowered: string[];
  tone: ConceptTone;
  target: CtaTarget;
  channels: { phone: boolean; whatsapp: boolean; email: boolean; visit: boolean };
};

type Item = { title: string; description: string };

type Copy = {
  tagline: Record<ConceptTone, string>;
  headline: (c: Ctx) => string;
  subheadline: (c: Ctx) => string;
  cta: Record<CtaTarget, string>;
  secondaryCta: string;
  aboutHeading: (c: Ctx) => string;
  aboutBody: (c: Ctx) => string;
  serviceDescriptions: string[];
  highlights: (c: Ctx) => Item[];
  testimonialsNote: string;
  gallery: (c: Ctx) => string[];
  contactHeading: string;
  contactBody: (c: Ctx) => string;
  seoTitle: (c: Ctx) => string;
  metaDescription: (c: Ctx) => string;
};

const EN: Copy = {
  tagline: {
    professional: "Clear advice and careful work",
    friendly: "Friendly service, close to you",
    luxury: "Refined service and attention to detail",
    energetic: "Let's get it done together",
  },
  headline: (c) => {
    const where = c.city ? ` in ${c.city}` : "";
    switch (c.tone) {
      case "professional":
        return `${c.phrase}${where}`;
      case "friendly":
        return `Welcome to ${c.name}`;
      case "luxury":
        return `Discover ${c.name}`;
      case "energetic":
        return `${c.phrase}${where} — let's talk!`;
    }
  },
  subheadline: (c) => {
    const list = joinList(c.lowered.slice(0, 3), "en");
    const where = c.city ? ` in ${c.city}` : "";
    switch (c.tone) {
      case "professional":
        return `${c.name} offers ${list}${where}. Get in touch to discuss what you need.`;
      case "friendly":
        return `We offer ${list}${where}. Come and see us or send us a message — we're happy to help.`;
      case "luxury":
        return `${capitalize(list)}${where}, offered with care and attention to detail.`;
      case "energetic":
        return `${c.name} offers ${list}. Call or message us today and let's talk about what you need.`;
    }
  },
  cta: { whatsapp: "Message us on WhatsApp", phone: "Call us", contact: "Get in touch" },
  secondaryCta: "See our services",
  aboutHeading: (c) => `About ${c.name}`,
  aboutBody: (c) => {
    const first = `At ${c.name}, we offer ${joinList(c.lowered, "en")}${c.city ? ` in ${c.city}` : ""}.`;
    const second: Record<ConceptTone, string> = {
      professional: "We take the time to understand what you need and explain your options clearly before we start.",
      friendly: "We like to keep things simple and personal: tell us what you need and we'll take it from there.",
      luxury: "Every request is handled with care and discretion, from the first conversation to the final detail.",
      energetic: "Tell us what you need — we're ready to help you move forward.",
    };
    return `${first} ${second[c.tone]}`;
  },
  serviceDescriptions: [
    "Tell us what you need and we'll explain the options that suit you.",
    "Careful work, from your first question to the finished result.",
    "Ask us anything — we're glad to give you all the details.",
    "Get in touch to talk it through and plan the next steps together.",
  ],
  highlights: (c) => {
    const local: Item = c.city
      ? { title: "Local and easy to find", description: `You'll find us in ${c.city}.` }
      : { title: "Easy to reach", description: "Send us a message whenever you need us." };
    const sets: Record<ConceptTone, Item[]> = {
      professional: [
        { title: "Clear communication", description: "We explain what we'll do and keep you informed along the way." },
        { title: "Careful work", description: "We take the time needed to do things properly." },
        local,
      ],
      friendly: [
        { title: "A warm welcome", description: "We take the time to listen and make you feel at home." },
        { title: "Simple and personal", description: "No complicated process — just tell us what you need." },
        local,
      ],
      luxury: [
        { title: "Attention to detail", description: "Every detail is considered, so you can simply enjoy the result." },
        { title: "Personal service", description: "Your requests are handled with discretion and care." },
        { title: "A calm experience", description: "An elegant, unhurried experience from start to finish." },
      ],
      energetic: [
        { title: "Ready when you are", description: "Send us a message and let's get moving." },
        { title: "Done properly", description: "We put energy and care into every job." },
        local,
      ],
    };
    return sets[c.tone];
  },
  testimonialsNote:
    "Add two or three short reviews from real customers here, with their permission. Never publish invented testimonials.",
  gallery: (c) => [
    ...c.services.slice(0, 3).map((s) => `${capitalize(s)} — a real photo of your work`),
    "Your team at work",
    "Your shop front or premises",
    "Happy customers (with their permission)",
  ],
  contactHeading: "Get in touch",
  contactBody: (c) => {
    const ways = [
      c.channels.phone && "call us",
      c.channels.whatsapp && "send us a WhatsApp message",
      c.channels.email && "email us",
      c.channels.visit && "visit us",
    ].filter((w): w is string => Boolean(w));
    if (!ways.length) return "Tell us what you need — we'll be happy to help.";
    return `${capitalize(joinList(ways, "en", "or"))}. We'll be happy to help.`;
  },
  seoTitle: (c) => (c.city ? `${c.name} — ${c.phrase} in ${c.city}` : `${c.name} — ${c.phrase}`),
  metaDescription: (c) =>
    `${c.name}: ${joinList(c.lowered.slice(0, 3), "en")}${c.city ? ` in ${c.city}` : ""}. ${EN.cta[c.target]} to discuss what you need.`,
};

const FR: Copy = {
  tagline: {
    professional: "Des conseils clairs, un travail soigné",
    friendly: "Un service chaleureux, près de chez vous",
    luxury: "Un service raffiné, le souci du détail",
    energetic: "Avançons ensemble",
  },
  headline: (c) => {
    const where = c.city ? ` à ${c.city}` : "";
    switch (c.tone) {
      case "professional":
        return `${c.phrase}${where}`;
      case "friendly":
        return `Bienvenue chez ${c.name}`;
      case "luxury":
        return `Découvrez ${c.name}`;
      case "energetic":
        return `${c.phrase}${where} : parlons-en !`;
    }
  },
  subheadline: (c) => {
    const list = joinList(c.lowered.slice(0, 3), "fr");
    const where = c.city ? ` à ${c.city}` : "";
    switch (c.tone) {
      case "professional":
        return `${c.name} propose ${list}${where}. Contactez-nous pour parler de votre besoin.`;
      case "friendly":
        return `Nous proposons ${list}${where}. Passez nous voir ou envoyez-nous un message : nous serons ravis de vous aider.`;
      case "luxury":
        return `${capitalize(list)}${where}, avec soin et le souci du détail.`;
      case "energetic":
        return `${c.name} propose ${list}. Appelez-nous ou écrivez-nous dès aujourd'hui pour en parler.`;
    }
  },
  cta: { whatsapp: "Écrire sur WhatsApp", phone: "Nous appeler", contact: "Nous contacter" },
  secondaryCta: "Voir nos services",
  aboutHeading: (c) => `À propos de ${c.name}`,
  aboutBody: (c) => {
    const first = `Chez ${c.name}, nous proposons ${joinList(c.lowered, "fr")}${c.city ? ` à ${c.city}` : ""}.`;
    const second: Record<ConceptTone, string> = {
      professional: "Nous prenons le temps de comprendre votre besoin et de vous présenter clairement les options avant de commencer.",
      friendly: "Nous aimons les choses simples et personnelles : dites-nous ce dont vous avez besoin, nous nous occupons du reste.",
      luxury: "Chaque demande est traitée avec soin et discrétion, du premier échange au moindre détail.",
      energetic: "Dites-nous ce dont vous avez besoin : nous sommes prêts à vous aider à avancer.",
    };
    return `${first} ${second[c.tone]}`;
  },
  serviceDescriptions: [
    "Dites-nous ce dont vous avez besoin : nous vous présenterons les options adaptées.",
    "Un travail soigné, de la première question au résultat final.",
    "Posez-nous vos questions, nous vous donnerons tous les détails.",
    "Contactez-nous pour en parler et organiser la suite ensemble.",
  ],
  highlights: (c) => {
    const local: Item = c.city
      ? { title: "Proche de vous", description: `Vous nous trouverez à ${c.city}.` }
      : { title: "Facile à joindre", description: "Envoyez-nous un message quand vous en avez besoin." };
    const sets: Record<ConceptTone, Item[]> = {
      professional: [
        { title: "Une communication claire", description: "Nous expliquons ce que nous allons faire et vous tenons informé à chaque étape." },
        { title: "Un travail soigné", description: "Nous prenons le temps nécessaire pour bien faire les choses." },
        local,
      ],
      friendly: [
        { title: "Un accueil chaleureux", description: "Nous prenons le temps de vous écouter et de vous mettre à l'aise." },
        { title: "Simple et personnel", description: "Pas de démarches compliquées : dites-nous simplement ce dont vous avez besoin." },
        local,
      ],
      luxury: [
        { title: "Le souci du détail", description: "Chaque détail est pensé pour que vous n'ayez plus qu'à profiter du résultat." },
        { title: "Un service personnalisé", description: "Vos demandes sont traitées avec discrétion et attention." },
        { title: "Une expérience sereine", description: "Une expérience élégante et sans précipitation, du début à la fin." },
      ],
      energetic: [
        { title: "Prêts quand vous l'êtes", description: "Envoyez-nous un message et passons à l'action." },
        { title: "Du travail bien fait", description: "Nous mettons de l'énergie et du soin dans chaque mission." },
        local,
      ],
    };
    return sets[c.tone];
  },
  testimonialsNote:
    "Ajoutez ici deux ou trois courts avis de vrais clients, avec leur accord. Ne publiez jamais de faux témoignages.",
  gallery: (c) => [
    ...c.services.slice(0, 3).map((s) => `${capitalize(s)} — une vraie photo de votre travail`),
    "Votre équipe au travail",
    "Votre devanture ou vos locaux",
    "Des clients satisfaits (avec leur accord)",
  ],
  contactHeading: "Contactez-nous",
  contactBody: (c) => {
    const ways = [
      c.channels.phone && "appelez-nous",
      c.channels.whatsapp && "écrivez-nous sur WhatsApp",
      c.channels.email && "envoyez-nous un e-mail",
      c.channels.visit && "passez nous voir",
    ].filter((w): w is string => Boolean(w));
    if (!ways.length) return "Dites-nous ce dont vous avez besoin : nous serons ravis de vous aider.";
    return `${capitalize(joinList(ways, "fr", "ou"))}. Nous serons ravis de vous aider.`;
  },
  seoTitle: (c) => (c.city ? `${c.name} — ${c.phrase} à ${c.city}` : `${c.name} — ${c.phrase}`),
  metaDescription: (c) =>
    `${c.name} : ${joinList(c.lowered.slice(0, 3), "fr")}${c.city ? ` à ${c.city}` : ""}. ${FR.cta[c.target]} pour parler de votre besoin.`,
};

export const TEMPLATE_COPY: Record<ConceptLanguage, Copy> = { en: EN, fr: FR };

/** Sections to render: the user's choice (in their order) or all sections in the default order. */
export function requestedSections(input: Pick<ConceptOptions, "sections">): ConceptSection[] {
  const s = input.sections?.length ? [...new Set(input.sections)] : [...CONCEPT_SECTIONS];
  return s.filter((x) => (CONCEPT_SECTIONS as readonly string[]).includes(x));
}

function context(input: ConceptOptions): Ctx {
  const name = input.contact.businessName.trim();
  const services = input.services.map((s) => s.trim()).filter(Boolean);
  const lowered = services.map(inSentence);
  const lang = input.language;
  const type = input.businessType?.trim();
  const phrase = capitalize(type || joinList(lowered.slice(0, 2), lang) || name);
  const city = input.contact.city?.trim() || null;
  const channels = {
    phone: telHref(input.contact.phone) !== null,
    whatsapp: whatsappHref(input.contact.whatsapp) !== null,
    email: mailtoHref(input.contact.email) !== null,
    visit: Boolean(input.contact.address?.trim()),
  };
  return { name, phrase, city, services, lowered, tone: input.tone, target: ctaTarget(input.contact), channels };
}

/** Template concept for the input. Always valid against `conceptContentSchema`. */
export function buildTemplateContent(input: ConceptOptions): ConceptContent {
  const copy = TEMPLATE_COPY[input.language] ?? EN;
  const c = context(input);
  const sections = requestedSections(input);

  const seoTitle = clampText(copy.seoTitle(c), L.seoTitle);
  const content: ConceptContent = {
    siteTitle: clampText(c.name, L.siteTitle),
    tagline: clampText(copy.tagline[c.tone], L.tagline),
    hero: {
      headline: clampText(copy.headline(c), L.headline),
      subheadline: clampText(copy.subheadline(c), L.subheadline),
      primaryCta: copy.cta[c.target],
      ...(sections.includes("services") ? { secondaryCta: copy.secondaryCta } : {}),
    },
    about: { heading: clampText(copy.aboutHeading(c), L.heading), body: clampText(copy.aboutBody(c), L.aboutBody) },
    services: c.services.slice(0, L.maxServices).map((s, i) => ({
      title: clampText(capitalize(s), L.itemTitle),
      description: copy.serviceDescriptions[i % copy.serviceDescriptions.length] ?? "",
    })),
    highlights: copy.highlights(c).slice(0, L.maxHighlights),
    testimonialsNote: copy.testimonialsNote,
    gallery: { ideas: copy.gallery(c).slice(0, L.maxGalleryIdeas).map((g) => clampText(g, L.galleryIdea)) },
    contact: { heading: copy.contactHeading, body: clampText(copy.contactBody(c), L.contactBody) },
    palette: stylePalette(input.style, input.primaryColor),
    typography: { pairing: STYLE_TYPOGRAPHY[input.style] ?? "modern-sans" },
    seo: { title: seoTitle.length >= 8 ? seoTitle : clampText(c.name, L.seoTitle), metaDescription: clampText(copy.metaDescription(c), L.seoDescription) },
    sections,
  };
  // Parse so the template output always goes through exactly the same validation as AI output.
  return conceptContentSchema.parse(content);
}
