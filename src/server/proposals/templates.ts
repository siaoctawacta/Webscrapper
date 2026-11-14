/**
 * Proposal templates, English and French, for every topic. Pure module (no DB, no secrets).
 *
 * Rules:
 * - Personalise only from facts we hold (see ./facts.ts) and the sender's own profile.
 * - A sentence whose facts are missing is left out entirely — the output never contains
 *   "undefined", "null", "N/A", empty brackets or doubled spaces.
 * - French uses vouvoiement and avoids gendered agreement (we don't know who reads it or writes it).
 */
import type { SenderProfile } from "@/lib/api-types";
import type { Language, ProposalTopic } from "@/lib/domain";
import { CLOSING, signatureLines } from "@/components/settings/signature";
import { cleanText, isRatingMentionable, type ProposalFacts, type WebsiteIssue } from "./facts";

export type TemplateInput = {
  topic: ProposalTopic;
  language: Language;
  facts: ProposalFacts;
  sender: SenderProfile;
  /** The user's own service description (topic "custom"). */
  customService?: string | null;
  /** Public link to a shared homepage concept for this business, if any. */
  conceptUrl?: string | null;
};

export type TemplateOutput = {
  subject: string;
  body: string;
  /** Facts the text actually uses, so the user can check nothing was invented. */
  factsUsed: Record<string, string | number | null>;
  warnings: string[];
};

export const SENDER_WARNING = "Add your name and contact details in Settings so prospects know who's writing.";
export const CUSTOM_SERVICE_WARNING = "Describe your service so the message can explain what you offer.";
export const NO_NAME_WARNING = "This business's name isn't available, so the message doesn't use it — add it yourself if you know it.";
export const NO_WEBSITE_REDESIGN_WARNING = "This business has no website listed — the “New website” topic may fit better.";

const NBSP = "\u00a0";
const SUBJECT_MAX = 120;

type Sentence = string | null | undefined | false;
type Paragraph = Sentence[] | string | null | undefined | false;

/* ───────────────────────────── helpers ───────────────────────────── */

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function listJoin(items: string[], lang: Language): string {
  const and = lang === "fr" ? "et" : "and";
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${and} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}${lang === "en" ? "," : ""} ${and} ${items.at(-1)}`;
}

const numberFormat = (lang: Language, digits = 0) =>
  new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** French punctuation (« », :, ?) takes a non-breaking space; written directly in the strings below. */
const quote = (s: string, lang: Language) => (lang === "fr" ? `«${NBSP}${s}${NBSP}»` : `“${s}”`);

/** Customer text used mid-sentence: no trailing full stop, first letter lowered unless it looks like a name/acronym. */
function serviceText(raw: string | null | undefined): string | null {
  const s = cleanText(raw, 200)?.replace(/[.!?;:,\s]+$/u, "");
  if (!s) return null;
  return /^\p{Lu}\p{Ll}/u.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function truncateSubject(s: string): string {
  return s.length > SUBJECT_MAX ? `${s.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : s;
}

/** Final pass: single spaces, no space before , or ., at most one blank line between paragraphs. */
export function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").replace(/ +([,.])/g, "$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function render(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => {
      if (!p) return "";
      if (typeof p === "string") return p;
      return p.filter((s): s is string => typeof s === "string" && s.trim() !== "").join(" ");
    })
    .filter((p) => p.trim() !== "")
    .join("\n\n");
}

/* ───────────────────────────── copy ───────────────────────────── */

type Ctx = {
  f: ProposalFacts;
  lang: Language;
  svc: string | null;
  used: Record<string, string | number | null>;
  /** Name, or a neutral fallback ("your business" / "votre établissement"). */
  biz: string;
};

function note(ctx: Ctx, key: string, value: string | number | null) {
  ctx.used[key] = value;
}

function greeting(ctx: Ctx): string {
  if (ctx.lang === "fr") return "Bonjour,";
  if (ctx.f.name) {
    note(ctx, "businessName", ctx.f.name);
    return `Hello ${ctx.f.name} team,`;
  }
  return "Hello,";
}

function intro(ctx: Ctx, sender: SenderProfile): string | null {
  const name = cleanText(sender.senderName);
  const company = cleanText(sender.senderCompany);
  if (ctx.lang === "fr") {
    if (name && company) return `Je m'appelle ${name} (${company}).`;
    if (name) return `Je m'appelle ${name}.`;
    if (company) return `Je vous écris de la part de ${company}.`;
    return null;
  }
  if (name && company) return `My name is ${name} from ${company}.`;
  if (name) return `My name is ${name}.`;
  if (company) return `I'm writing from ${company}.`;
  return null;
}

const SERVICE: Record<Language, Record<Exclude<ProposalTopic, "custom">, string>> = {
  en: {
    new_website: "I help local businesses get online with simple websites that bring in new customers.",
    website_redesign: "I help local businesses turn their websites into a real source of new customers.",
    local_seo: "I help local businesses get found on Google and Google Maps.",
    social_media: "I help local businesses grow and stay visible on social media.",
    branding: "I help local businesses build a clear, memorable brand: logo, colours and a consistent look across signs, social media and print.",
  },
  fr: {
    new_website: "J'aide les entreprises locales à se faire connaître en ligne grâce à des sites web simples qui attirent de nouveaux clients.",
    website_redesign: "J'aide les entreprises locales à faire de leur site web une vraie source de nouveaux clients.",
    local_seo: "J'aide les entreprises locales à être trouvées sur Google et Google Maps.",
    social_media: "J'aide les entreprises locales à se développer et à rester visibles sur les réseaux sociaux.",
    branding: `J'aide les entreprises locales à construire une image de marque claire et mémorable${NBSP}: logo, couleurs et identité cohérente sur l'enseigne, les réseaux sociaux et les supports imprimés.`,
  },
};

function serviceLine(ctx: Ctx, topic: ProposalTopic): string {
  if (topic !== "custom") return SERVICE[ctx.lang][topic];
  if (ctx.svc) {
    note(ctx, "customService", ctx.svc);
    return ctx.lang === "fr"
      ? `J'accompagne les entreprises locales avec le service suivant${NBSP}: ${ctx.svc}.`
      : `I help local businesses with ${ctx.svc}.`;
  }
  return ctx.lang === "fr" ? "J'aide les entreprises locales à se développer." : "I help local businesses grow.";
}

/**
 * "I came across X, a hotel in Lomé" (+ optional "and noticed you don't have a website yet").
 * With nothing known about the business the sentence is left out (or reduced to the no-website remark).
 */
function discovery(ctx: Ctx, opts: { noWebsite?: boolean } = {}): string | null {
  const { name, category: cat, city } = ctx.f;
  const noWebsite = Boolean(opts.noWebsite);
  if (noWebsite) note(ctx, "websiteStatus", "none");
  if (!name && !cat && !city) {
    if (!noWebsite) return null;
    return ctx.lang === "fr" ? "J'ai remarqué que vous n'avez pas encore de site web." : "I noticed you don't have a website yet.";
  }
  if (name) note(ctx, "businessName", name);
  if (cat) note(ctx, "category", cat);
  if (city) note(ctx, "city", city);

  if (ctx.lang === "fr") {
    let s: string;
    let apposition = false;
    if (name) {
      if (cat) {
        s = `J'ai découvert ${name}, ${cat}${city ? ` à ${city}` : ""}`;
        apposition = true;
      } else s = `J'ai découvert ${name}${city ? `, à ${city}` : ""}`;
      apposition ||= Boolean(city);
    } else {
      s = `J'ai découvert votre établissement${city ? ` à ${city}` : ""}${cat ? ` (${cat})` : ""}`;
    }
    if (!noWebsite) return `${s}.`;
    return `${s}${apposition ? "," : ""} et j'ai remarqué que vous n'avez pas encore de site web.`;
  }

  let s: string;
  if (name) s = `I came across ${name}${cat ? `, ${article(cat)} ${cat}${city ? ` in ${city}` : ""},` : city ? ` in ${city}` : ""}`;
  else s = `I came across your ${cat ?? "business"}${city ? ` in ${city}` : ""}`;
  s = s.replace(/,$/, noWebsite ? "," : "");
  return noWebsite ? `${s} and noticed you don't have a website yet.` : `${s}.`;
}

function ratingSentence(ctx: Ctx, variant: "congrats" | "base"): string | null {
  const { rating, reviewCount, source } = ctx.f;
  if (!isRatingMentionable(rating, reviewCount) || reviewCount === null) return null;
  const onMaps = source === "google_places";
  const r = numberFormat(ctx.lang, 1).format(rating);
  const n = numberFormat(ctx.lang).format(reviewCount);
  note(ctx, "rating", rating);
  note(ctx, "reviewCount", reviewCount);
  if (onMaps) note(ctx, "ratingSource", "Google Maps");

  if (ctx.lang === "fr") {
    const where = onMaps ? " sur Google Maps" : "";
    return variant === "congrats"
      ? `Félicitations pour votre note de ${r}/5${where} (${n} avis)${NBSP}: vos clients apprécient visiblement votre travail.`
      : `Vous avez déjà une note de ${r}/5${where} (${n} avis), une excellente base sur laquelle s'appuyer.`;
  }
  const where = onMaps ? " on Google Maps" : "";
  const reviews = reviewCount === 1 ? "review" : "reviews";
  return variant === "congrats"
    ? `Congratulations on your ${r}-star rating from ${n} ${reviews}${where}. Your customers clearly appreciate what you do.`
    : `You already have a ${r}-star rating from ${n} ${reviews}${where}, which is a strong base to build on.`;
}

/** "“hotel in Lomé”" / "« hôtel à Lomé »" — what a customer would type. Null without a category. */
function searchPhrase(ctx: Ctx): string | null {
  const { category: cat, city } = ctx.f;
  if (!cat) return null;
  note(ctx, "category", cat);
  if (city) note(ctx, "city", city);
  const text = city ? `${cat} ${ctx.lang === "fr" ? "à" : "in"} ${city}` : cat;
  return quote(text, ctx.lang);
}

function issueLine(issue: WebsiteIssue, lang: Language): string {
  switch (issue.kind) {
    case "no_https":
      return lang === "fr"
        ? `- Il n'utilise pas de connexion sécurisée (HTTPS), et les navigateurs peuvent l'afficher comme ${quote("Non sécurisé", "fr")}.`
        : "- It doesn't use a secure connection (HTTPS), so browsers may label it “Not secure”.";
    case "not_mobile":
      return lang === "fr" ? "- Il ne semble pas adapté aux écrans de téléphone." : "- It doesn't appear to be optimised for phone screens.";
    case "old_copyright":
      return lang === "fr"
        ? `- Le pied de page de votre site indique encore © ${issue.year}, ce qui peut laisser penser que les informations ne sont plus à jour.`
        : `- Your site's footer still says © ${issue.year}, which can make visitors think the information is out of date.`;
  }
}

const ISSUE_FACT: Record<WebsiteIssue["kind"], string> = {
  no_https: "no HTTPS",
  not_mobile: "not mobile-friendly",
  old_copyright: "old © year",
};

function conceptLine(ctx: Ctx, url: string | null | undefined): string | null {
  if (!url) return null;
  note(ctx, "conceptUrl", url);
  return ctx.lang === "fr"
    ? `J'ai également préparé une première idée de page d'accueil pour ${ctx.biz}, que vous pouvez consulter ici${NBSP}: ${url}`
    : `I've also put together a first homepage idea for ${ctx.biz}. You can see it here: ${url}`;
}

const CTA: Record<Language, { short: string; about: string }> = {
  en: { short: "Would you be open to a short call this week?", about: "Would you be open to a short call this week to talk about it?" },
  fr: {
    short: `Seriez-vous disponible cette semaine pour un court échange${NBSP}?`,
    about: `Seriez-vous disponible cette semaine pour un court échange à ce sujet${NBSP}?`,
  },
};

/* ───────────────────────────── topics ───────────────────────────── */

type TopicCopy = { subject: string; paragraphs: Paragraph[] };

function newWebsite(ctx: Ctx, head: Paragraph[], conceptUrl?: string | null): TopicCopy {
  const { f, lang } = ctx;
  const noWebsite = f.websiteStatus === "none";
  const phrase = searchPhrase(ctx);
  if (lang === "fr") {
    return {
      subject: f.name ? `Un site web pour ${f.name}` : "Un site web pour votre entreprise",
      paragraphs: [
        ...head,
        [discovery(ctx, { noWebsite }), ratingSentence(ctx, "congrats")],
        [
          "Aujourd'hui, la plupart des clients font une recherche en ligne avant de se déplacer ou d'appeler.",
          phrase
            ? `Quand quelqu'un cherche ${phrase}, un site web l'aide à vous trouver, à vous faire confiance et à vous contacter.`
            : "Un site web les aide à vous trouver, à vous faire confiance et à vous contacter.",
        ],
        [
          "Je peux vous créer un site simple et adapté aux téléphones, qui présente vos services, avec un bouton WhatsApp pour que vos clients vous écrivent en un clic et votre localisation Google Maps pour qu'ils vous trouvent facilement.",
        ],
        [conceptLine(ctx, conceptUrl)],
        [CTA.fr.about],
      ],
    };
  }
  return {
    subject: f.name ? `A website for ${f.name}` : "A website for your business",
    paragraphs: [
      ...head,
      [discovery(ctx, { noWebsite }), ratingSentence(ctx, "congrats")],
      [
        "Today, most customers look a business up online before they visit or call.",
        phrase
          ? `When someone searches for ${phrase}, a website helps them find you, trust you and get in touch.`
          : "A website helps them find you, trust you and get in touch.",
      ],
      [
        "I can build you a simple, mobile-friendly site that presents your services, with a WhatsApp button so customers can message you in one tap and your Google Maps location so they can find you easily.",
      ],
      [conceptLine(ctx, conceptUrl)],
      [CTA.en.about],
    ],
  };
}

function websiteRedesign(ctx: Ctx, head: Paragraph[], conceptUrl?: string | null): TopicCopy {
  const { f, lang } = ctx;
  const fr = lang === "fr";
  const host = f.websiteHost;
  let review: Paragraph;
  if (f.websiteStatus === "none") {
    note(ctx, "websiteStatus", "none");
    review = fr
      ? [f.name ? `J'ai remarqué que ${f.name} n'a pas encore de site web.` : "J'ai remarqué que vous n'avez pas encore de site web."]
      : [f.name ? `I noticed ${f.name} doesn't have a website yet.` : "I noticed you don't have a website yet."];
  } else if (f.websiteIssues.length > 0) {
    if (host) note(ctx, "website", host);
    note(ctx, "websiteIssues", f.websiteIssues.map((i) => (i.kind === "old_copyright" ? `© ${i.year}` : ISSUE_FACT[i.kind])).join("; "));
    const lead = fr
      ? `J'ai consulté ${host ?? "votre site web"} et j'ai remarqué quelques points qui peuvent vous faire perdre des clients${NBSP}:`
      : `I had a look at ${host ?? "your website"} and noticed a few things that may be costing you customers:`;
    review = [lead, ...f.websiteIssues.map((i) => issueLine(i, lang))].join("\n");
  } else if (f.websiteChecked) {
    if (host) note(ctx, "website", host);
    review = fr
      ? [`J'ai consulté ${host ?? "votre site web"} et j'ai quelques idées pour qu'il vous apporte encore plus de clients.`]
      : [`I had a look at ${host ?? "your website"}, and I have a few ideas that could help it bring in even more customers.`];
  } else {
    review = fr
      ? [`Un site web modernisé pourrait aider ${ctx.biz} à attirer davantage de clients.`]
      : [`A refreshed website could help ${ctx.biz} bring in more customers.`];
  }

  if (fr) {
    return {
      subject: f.name ? `${f.name}${NBSP}: quelques idées pour votre site web` : "Quelques idées pour votre site web",
      paragraphs: [
        ...head,
        [discovery(ctx), ratingSentence(ctx, "congrats")],
        review,
        [
          "Un site moderne, rapide et adapté aux téléphones permet à vos clients de vous faire confiance et de vous contacter plus facilement.",
          "Je peux vous envoyer quelques suggestions concrètes, sans engagement.",
        ],
        [conceptLine(ctx, conceptUrl)],
        [CTA.fr.short],
      ],
    };
  }
  return {
    subject: f.name ? `A few ideas for the ${f.name} website` : "A few ideas for your website",
    paragraphs: [
      ...head,
      [discovery(ctx), ratingSentence(ctx, "congrats")],
      review,
      [
        "A modern, fast and mobile-friendly site makes it easier for customers to trust you and get in touch, especially on their phones.",
        "I'd be happy to share a few concrete suggestions, free of charge.",
      ],
      [conceptLine(ctx, conceptUrl)],
      [CTA.en.short],
    ],
  };
}

function localSeo(ctx: Ctx, head: Paragraph[], conceptUrl?: string | null): TopicCopy {
  const { f, lang } = ctx;
  const phrase = searchPhrase(ctx);
  const noWebsite = f.websiteStatus === "none";
  if (noWebsite) note(ctx, "websiteStatus", "none");
  if (lang === "fr") {
    return {
      subject: f.name ? `Plus de visibilité sur Google pour ${f.name}` : "Plus de visibilité sur Google pour votre entreprise",
      paragraphs: [
        ...head,
        [discovery(ctx), ratingSentence(ctx, "base")],
        [
          phrase
            ? `Quand des clients proches cherchent ${phrase}, ce sont les établissements qui apparaissent en premier qu'ils appellent.`
            : "Quand des clients proches font une recherche sur Google, ce sont les établissements qui apparaissent en premier qu'ils appellent.",
          noWebsite
            ? "Une fiche Google Business Profile complète, accompagnée d'un site web simple, donne aux clients plus de raisons de vous choisir."
            : "Une fiche Google Business Profile complète et à jour, reliée à votre site web, donne aux clients plus de raisons de vous choisir.",
        ],
        [
          "Je peux vous aider avec des informations exactes, de belles photos, les bonnes catégories et des mises à jour régulières, pour que davantage de clients à proximité vous trouvent.",
        ],
        [conceptLine(ctx, conceptUrl)],
        [CTA.fr.short],
      ],
    };
  }
  return {
    subject: f.name ? `Helping ${f.name} get found on Google` : "Helping your business get found on Google",
    paragraphs: [
      ...head,
      [discovery(ctx), ratingSentence(ctx, "base")],
      [
        phrase
          ? `When people nearby search for ${phrase}, the businesses that show up first are the ones they call.`
          : "When people nearby search on Google, the businesses that show up first are the ones they call.",
        noWebsite
          ? "A complete Google Business Profile, together with a simple website, gives customers more reasons to choose you."
          : "A complete, up-to-date Google Business Profile linked to your website gives customers more reasons to choose you.",
      ],
      ["I can help with accurate details, good photos, the right categories and regular updates, so more customers nearby find you."],
      [conceptLine(ctx, conceptUrl)],
      [CTA.en.short],
    ],
  };
}

function socialMedia(ctx: Ctx, head: Paragraph[], conceptUrl?: string | null): TopicCopy {
  const { f, lang } = ctx;
  const fr = lang === "fr";
  let presence: string | null = null;
  if (f.socialNetworks.length > 0) {
    note(ctx, "socials", f.socialNetworks.join(", "));
    const list = listJoin(f.socialNetworks, lang);
    presence = fr ? `J'ai vu que vous utilisez déjà ${list}, c'est un très bon début.` : `I saw that you're already on ${list}, which is a great start.`;
  } else if (f.websiteChecked) {
    note(ctx, "socials", "none found on website");
    presence = fr
      ? "Je n'ai trouvé aucune page de réseau social liée à votre site web."
      : "I couldn't find any social media pages linked from your website.";
  }
  if (fr) {
    return {
      subject: f.name ? `Réseaux sociaux${NBSP}: quelques idées pour ${f.name}` : `Réseaux sociaux${NBSP}: quelques idées pour votre entreprise`,
      paragraphs: [
        ...head,
        [discovery(ctx), ratingSentence(ctx, "congrats")],
        [presence, "Des publications régulières et soignées aident les clients à vous découvrir, à voir votre travail et à vous écrire directement."],
        [
          `Je peux planifier et créer des contenus adaptés à ${ctx.biz}, pour une présence régulière sans que vous y passiez des heures.`,
          `On pourrait commencer par un plan simple${NBSP}: quelques publications par semaine pour montrer votre travail, votre équipe et vos actualités, avec un lien WhatsApp pour qu'on vous contacte en un clic.`,
        ],
        [conceptLine(ctx, conceptUrl)],
        [CTA.fr.short],
      ],
    };
  }
  return {
    subject: f.name ? `Social media ideas for ${f.name}` : "Social media ideas for your business",
    paragraphs: [
      ...head,
      [discovery(ctx), ratingSentence(ctx, "congrats")],
      [presence, "Regular, good-looking posts help customers discover you, see your work and message you directly."],
      [
        `I can plan and create content that fits ${ctx.biz}, so you stay visible without spending hours on it.`,
        "We could start with a simple plan: a few posts a week showing your work, your team and your news, with a WhatsApp link so people can reach you in one tap.",
      ],
      [conceptLine(ctx, conceptUrl)],
      [CTA.en.short],
    ],
  };
}

function branding(ctx: Ctx, head: Paragraph[], conceptUrl?: string | null): TopicCopy {
  const { f, lang } = ctx;
  if (lang === "fr") {
    return {
      subject: f.name ? `Image de marque${NBSP}: quelques idées pour ${f.name}` : `Image de marque${NBSP}: quelques idées pour votre entreprise`,
      paragraphs: [
        ...head,
        [discovery(ctx), ratingSentence(ctx, "congrats")],
        [
          "Une identité cohérente rend une entreprise plus facile à reconnaître, à retenir et à recommander.",
          "Elle donne à chaque enseigne, flyer et publication l'image d'une maison sérieuse et digne de confiance.",
        ],
        [
          "On pourrait commencer par une modernisation simple de votre logo et de vos couleurs, puis l'appliquer partout où vos clients vous voient.",
          `Je peux vous partager quelques premières idées pour ${ctx.biz}, sans engagement.`,
        ],
        [conceptLine(ctx, conceptUrl)],
        [CTA.fr.short],
      ],
    };
  }
  return {
    subject: f.name ? `Branding ideas for ${f.name}` : "Branding ideas for your business",
    paragraphs: [
      ...head,
      [discovery(ctx), ratingSentence(ctx, "congrats")],
      [
        "A consistent identity makes a business easier to recognise, remember and recommend.",
        "It makes every sign, flyer and post look like it comes from the same trusted place.",
      ],
      [
        "We could start with a simple refresh of your logo and colours, then apply it everywhere your customers see you.",
        `I'd be glad to share a few first ideas for ${ctx.biz}, with no obligation.`,
      ],
      [conceptLine(ctx, conceptUrl)],
      [CTA.en.short],
    ],
  };
}

function custom(ctx: Ctx, head: Paragraph[], conceptUrl?: string | null): TopicCopy {
  const { f, lang, svc } = ctx;
  if (lang === "fr") {
    return {
      subject: svc ? `${cap(svc)} pour ${f.name ?? "votre entreprise"}` : f.name ? `Une proposition pour ${f.name}` : "Une proposition pour votre entreprise",
      paragraphs: [
        ...head,
        [discovery(ctx), ratingSentence(ctx, "congrats")],
        [
          svc
            ? `Je pense que ce service pourrait convenir à ${ctx.biz}, et je peux vous expliquer simplement comment il fonctionnerait pour vous.`
            : `Je peux vous expliquer simplement comment je pourrais aider ${ctx.biz}.`,
          "Des améliorations simples et bien choisies peuvent vraiment changer la façon dont les clients trouvent et choisissent une entreprise.",
        ],
        ["Nous commencerions par un court échange sur vos objectifs, puis je vous proposerais un plan simple avec des étapes claires."],
        [conceptLine(ctx, conceptUrl)],
        [CTA.fr.short],
      ],
    };
  }
  return {
    subject: svc ? `${cap(svc)} for ${f.name ?? "your business"}` : f.name ? `An idea for ${f.name}` : "An idea for your business",
    paragraphs: [
      ...head,
      [discovery(ctx), ratingSentence(ctx, "congrats")],
      [
        svc
          ? `I think ${svc} could be a good fit for ${ctx.biz}, and I'd be happy to explain how it would work for you.`
          : `I'd be happy to explain how I could help ${ctx.biz}.`,
        "Small, well-chosen improvements can make a real difference to how customers find and choose a business.",
      ],
      ["We would start with a short conversation about your goals, and I'd then suggest a simple plan with clear next steps."],
      [conceptLine(ctx, conceptUrl)],
      [CTA.en.short],
    ],
  };
}

const TOPICS: Record<ProposalTopic, (ctx: Ctx, head: Paragraph[], conceptUrl?: string | null) => TopicCopy> = {
  new_website: newWebsite,
  website_redesign: websiteRedesign,
  local_seo: localSeo,
  social_media: socialMedia,
  branding,
  custom,
};

/* ───────────────────────────── entry point ───────────────────────────── */

/** Closing + sender signature, and whether the sender profile is complete enough. */
export function signOff(sender: SenderProfile, lang: Language): { text: string; lines: string[]; complete: boolean } {
  const sig = signatureLines(sender);
  const hasName = Boolean(sender.senderName?.trim());
  const hasContact = Boolean(sender.senderEmail?.trim() || sender.senderPhone?.trim());
  const complete = sig.source === "signature" || (sig.source === "details" && hasName && hasContact);
  return { text: [CLOSING[lang], ...sig.lines].join("\n"), lines: sig.lines, complete };
}

export function buildTemplate(input: TemplateInput): TemplateOutput {
  const { topic, language: lang, facts: f, sender } = input;
  const ctx: Ctx = {
    f,
    lang,
    svc: topic === "custom" ? serviceText(input.customService) : null,
    used: {},
    biz: f.name ?? (lang === "fr" ? "votre établissement" : "your business"),
  };
  const warnings: string[] = [];

  const head: Paragraph[] = [greeting(ctx), [intro(ctx, sender), serviceLine(ctx, topic)]];
  const copy = TOPICS[topic](ctx, head, input.conceptUrl);
  const sign = signOff(sender, lang);

  if (!sign.complete) warnings.push(SENDER_WARNING);
  if (topic === "custom" && !ctx.svc) warnings.push(CUSTOM_SERVICE_WARNING);
  if (!f.name) warnings.push(NO_NAME_WARNING);
  if (topic === "website_redesign" && f.websiteStatus === "none") warnings.push(NO_WEBSITE_REDESIGN_WARNING);

  const body = tidy(`${render(copy.paragraphs)}\n\n${sign.text}`);
  return { subject: truncateSubject(tidy(copy.subject)), body, factsUsed: ctx.used, warnings };
}

/** Words in the message itself (greeting to call-to-action), excluding the sign-off. */
export function countWords(body: string, sender: SenderProfile, lang: Language): number {
  const sign = signOff(sender, lang).text;
  const main = body.endsWith(sign) ? body.slice(0, body.length - sign.length) : body;
  return main.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
