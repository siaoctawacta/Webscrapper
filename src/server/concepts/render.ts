/**
 * Renders a concept into one standalone, static HTML5 document. Pure module.
 *
 * Safety model (the page is served under a CSP that forbids scripts, external fonts and images):
 *  - every text node and attribute value is HTML-escaped, attributes always double-quoted;
 *  - links: only https:, tel:, mailto: and https://wa.me/, built from the user-confirmed contact block;
 *  - colours: only #rrggbb (anything else falls back to the preset palette);
 *  - fonts: only fixed system stacks chosen from an allowlist;
 *  - no <script>, no inline event handlers, no external resources, no user-controlled CSS.
 */
import { FONT_STACKS, STYLE_PALETTES, contrastRatio, isHexColor, readableOn } from "./design";
import { httpsHref, isAllowedHref, mailtoHref, telHref, whatsappHref, type ContactLinkSource } from "./links";
import { CONCEPT_SECTIONS, PALETTE_KEYS, TYPOGRAPHY_PAIRINGS, isGoogleMapsUrl, type ConceptContent, type ConceptLanguage, type ConceptPalette, type ConceptSection, type TypographyPairing } from "./schema";

export type RenderContact = ContactLinkSource & {
  businessName: string;
  address?: string | null;
  city?: string | null;
};

export type RenderOptions = {
  /** e.g. the sender's company: rendered as "Concept by …" in the footer. */
  footerCredit?: string | null;
  language?: ConceptLanguage;
  /** Year shown in the footer (default: current year). */
  year?: number;
};

/* ───────────────────────────── Escaping ───────────────────────────── */

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Escape for both text content and double-quoted attribute values. */
export function escapeHtml(value: unknown): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.replace(CONTROL_RE, "").replace(/[&<>"'`]/g, (ch) => ESC[ch] ?? ch);
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(CONTROL_RE, "").trim() : "");

/** Escaped text with paragraph breaks preserved. */
function paragraphs(text: string, cls?: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function link(href: string | null, label: string, cls?: string, extra = ""): string {
  if (!href || !isAllowedHref(href)) return "";
  const external = href.startsWith("https://");
  return `<a${cls ? ` class="${cls}"` : ""} href="${escapeHtml(href)}"${external ? ` rel="noopener noreferrer nofollow"` : ""}${extra}>${escapeHtml(label)}</a>`;
}

/* ───────────────────────────── Labels ───────────────────────────── */

const LABELS = {
  en: {
    nav: { services: "Services", about: "About", highlights: "Why us", gallery: "Gallery", testimonials: "Reviews", contact: "Contact" },
    servicesHeading: "Our services",
    highlightsHeading: "Why choose us",
    galleryHeading: "Gallery",
    photoIdea: "Photo idea",
    testimonialsHeading: "What customers say",
    placeholder: "Placeholder",
    phone: "Phone",
    whatsapp: "WhatsApp",
    email: "Email",
    address: "Address",
    maps: "Open in Google Maps",
    whatsappAction: "Message on WhatsApp",
    concept: "Homepage concept",
    conceptBy: (who: string) => `Homepage concept by ${who}`,
    navLabel: "Sections",
  },
  fr: {
    nav: { services: "Services", about: "À propos", highlights: "Nos atouts", gallery: "Galerie", testimonials: "Avis", contact: "Contact" },
    servicesHeading: "Nos services",
    highlightsHeading: "Pourquoi nous choisir",
    galleryHeading: "Galerie",
    photoIdea: "Idée de photo",
    testimonialsHeading: "Ce que disent nos clients",
    placeholder: "Emplacement réservé",
    phone: "Téléphone",
    whatsapp: "WhatsApp",
    email: "E-mail",
    address: "Adresse",
    maps: "Ouvrir dans Google Maps",
    whatsappAction: "Écrire sur WhatsApp",
    concept: "Proposition de page d'accueil",
    conceptBy: (who: string) => `Proposition de page d'accueil par ${who}`,
    navLabel: "Sections",
  },
} as const;

type Labels = (typeof LABELS)[ConceptLanguage];

/* ───────────────────────────── Design tokens ───────────────────────────── */

function safePalette(p: Partial<Record<keyof ConceptPalette, unknown>> | undefined): ConceptPalette {
  const fallback = STYLE_PALETTES.modern;
  if (!p || !PALETTE_KEYS.every((k) => isHexColor(p[k]))) return fallback;
  return Object.fromEntries(PALETTE_KEYS.map((k) => [k, (p[k] as string).toLowerCase()])) as ConceptPalette;
}

function safePairing(v: unknown): TypographyPairing {
  return (TYPOGRAPHY_PAIRINGS as readonly unknown[]).includes(v) ? (v as TypographyPairing) : "modern-sans";
}

function styles(p: ConceptPalette, pairing: TypographyPairing): string {
  const fonts = FONT_STACKS[pairing];
  // Coloured text (eyebrows, links) must stay readable: fall back to the text colour when the primary is too light/dark.
  const ink = contrastRatio(p.primary, p.background) >= 4.5 ? p.primary : p.text;
  const surfaceInk = contrastRatio(p.primary, p.surface) >= 4.5 ? p.primary : p.text;
  const onPrimary = readableOn(p.primary);
  const onSecondary = readableOn(p.secondary);
  return `
:root{--primary:${p.primary};--on-primary:${onPrimary};--secondary:${p.secondary};--on-secondary:${onSecondary};--accent:${p.accent};--bg:${p.background};--surface:${p.surface};--text:${p.text};--ink:${ink};--surface-ink:${surfaceInk};--heading-font:${fonts.heading};--body-font:${fonts.body};--radius:14px}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--body-font);font-size:16px;line-height:1.65;overflow-wrap:anywhere}
h1,h2,h3{font-family:var(--heading-font);line-height:1.15;letter-spacing:-0.01em;margin:0 0 .5em;overflow-wrap:break-word}
h1{font-size:clamp(2rem,6vw,3.4rem);font-weight:700}
h2{font-size:clamp(1.5rem,3.6vw,2.1rem);font-weight:700}
h3{font-size:1.1rem;font-weight:650}
p{margin:0 0 1em}
a{color:var(--ink)}
.container{width:100%;max-width:1080px;margin:0 auto;padding:0 20px}
.site-header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.header-inner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 24px;padding-top:14px;padding-bottom:14px}
.brand{font-family:var(--heading-font);font-weight:700;font-size:1.1rem;color:var(--text);text-decoration:none}
.site-nav{display:flex;flex-wrap:wrap;gap:6px 18px;max-width:100%}
.site-nav a{color:var(--text);opacity:.8;text-decoration:none;font-size:.92rem;white-space:nowrap}
.site-nav a:hover,.site-nav a:focus-visible{opacity:1;text-decoration:underline}
section{padding:64px 0}
.hero{padding:72px 0 80px;background:var(--surface)}
.eyebrow{color:var(--surface-ink);font-weight:600;font-size:.95rem;margin-bottom:.75em}
.lead{font-size:1.15rem;max-width:40em;opacity:.9}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:10px 22px;border-radius:999px;font-weight:600;text-decoration:none;border:2px solid var(--primary)}
.btn-primary{background:var(--primary);color:var(--on-primary)}
.btn-secondary{background:transparent;color:var(--surface-ink);border-color:currentColor}
.btn:focus-visible,.site-nav a:focus-visible,.contact-list a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.grid{display:grid;gap:18px;grid-template-columns:1fr}
.card{background:var(--surface);border-radius:var(--radius);padding:22px;color:var(--text)}
.card p{margin:0}
.card h3{color:var(--surface-ink)}
.about{max-width:46em}
.highlights .card{background:transparent;border:1px solid color-mix(in srgb,var(--text) 14%,transparent)}
.highlights .card h3{color:var(--ink)}
.gallery-grid{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}
.tile{margin:0;border-radius:var(--radius);overflow:hidden;background:var(--surface)}
.tile-art{aspect-ratio:4/3;background:linear-gradient(135deg,var(--primary),var(--accent))}
.tile:nth-child(3n+2) .tile-art{background:linear-gradient(160deg,var(--secondary),var(--primary))}
.tile:nth-child(3n) .tile-art{background:linear-gradient(115deg,var(--accent),var(--secondary))}
.tile figcaption{padding:10px 12px;font-size:.88rem}
.placeholder{border:2px dashed color-mix(in srgb,var(--text) 30%,transparent);border-radius:var(--radius);padding:24px;max-width:46em}
.badge{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 10px;border-radius:999px;background:var(--surface);color:var(--surface-ink);margin-bottom:12px}
.contact{background:var(--secondary);color:var(--on-secondary)}
.contact a{color:var(--on-secondary)}
.contact-list{list-style:none;margin:24px 0 0;padding:0;display:grid;gap:12px}
.contact-list li{display:flex;flex-wrap:wrap;gap:4px 12px}
.contact-list .label{font-weight:600;min-width:7em;opacity:.85}
.contact-actions{margin:28px 0 0}
.contact .btn-outline{background:transparent;color:var(--on-secondary);border-color:currentColor}
.contact .btn-outline:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.site-footer{padding:28px 0;font-size:.88rem}
.site-footer p{margin:0 0 4px}
.muted{opacity:.7}
@media (min-width:640px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gallery-grid{grid-template-columns:repeat(3,minmax(0,1fr))}section{padding:80px 0}.hero{padding:104px 0 112px}}
@media (min-width:960px){.services .grid{grid-template-columns:repeat(3,minmax(0,1fr))}.highlights .grid{grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`.trim();
}

/* ───────────────────────────── Sections ───────────────────────────── */

type Ctx = {
  c: ConceptContent;
  contact: RenderContact;
  t: Labels;
  sections: ConceptSection[];
  links: { tel: string | null; wa: string | null; mail: string | null; maps: string | null };
};

function primaryCtaHref(x: Ctx): string | null {
  if (x.links.wa) return x.links.wa;
  if (x.links.tel) return x.links.tel;
  return x.sections.includes("contact") ? "#contact" : null;
}

function hero(x: Ctx): string {
  const h = x.c.hero ?? ({} as ConceptContent["hero"]);
  const primary = primaryCtaHref(x);
  const secondaryTarget = x.sections.includes("services") ? "#services" : x.sections.includes("contact") ? "#contact" : null;
  const primaryLabel = str(h.primaryCta);
  const secondaryLabel = str(h.secondaryCta);
  const buttons = [
    primary && primaryLabel ? link(primary, primaryLabel, "btn btn-primary") : "",
    secondaryTarget && secondaryLabel && secondaryTarget !== primary ? link(secondaryTarget, secondaryLabel, "btn btn-secondary") : "",
  ].join("");
  const tagline = str(x.c.tagline);
  const sub = str(h.subheadline);
  return `<section class="hero" id="top" aria-labelledby="hero-title"><div class="container">${tagline ? `<p class="eyebrow">${escapeHtml(tagline)}</p>` : ""}<h1 id="hero-title">${escapeHtml(str(h.headline) || str(x.c.siteTitle) || x.contact.businessName)}</h1>${sub ? `<p class="lead">${escapeHtml(sub)}</p>` : ""}${buttons ? `<div class="actions">${buttons}</div>` : ""}</div></section>`;
}

function services(x: Ctx): string {
  const items = (Array.isArray(x.c.services) ? x.c.services : []).filter((s) => str(s?.title));
  if (!items.length) return "";
  const cards = items
    .map((s) => `<article class="card"><h3>${escapeHtml(str(s.title))}</h3>${str(s.description) ? `<p>${escapeHtml(str(s.description))}</p>` : ""}</article>`)
    .join("");
  return `<section class="services" id="services" aria-labelledby="services-title"><div class="container"><h2 id="services-title">${escapeHtml(x.t.servicesHeading)}</h2><div class="grid">${cards}</div></div></section>`;
}

function about(x: Ctx): string {
  const heading = str(x.c.about?.heading);
  const body = str(x.c.about?.body);
  if (!heading && !body) return "";
  return `<section id="about" aria-labelledby="about-title"><div class="container"><div class="about"><h2 id="about-title">${escapeHtml(heading || x.t.nav.about)}</h2>${paragraphs(body)}</div></div></section>`;
}

function highlights(x: Ctx): string {
  const items = (Array.isArray(x.c.highlights) ? x.c.highlights : []).filter((h) => str(h?.title));
  if (!items.length) return "";
  const cols = Math.min(Math.max(items.length, 1), 4);
  const cards = items
    .map((h) => `<article class="card"><h3>${escapeHtml(str(h.title))}</h3>${str(h.description) ? `<p>${escapeHtml(str(h.description))}</p>` : ""}</article>`)
    .join("");
  return `<section class="highlights" id="highlights" aria-labelledby="highlights-title"><div class="container"><h2 id="highlights-title">${escapeHtml(x.t.highlightsHeading)}</h2><div class="grid" style="--cols:${cols}">${cards}</div></div></section>`;
}

function gallery(x: Ctx): string {
  const ideas = (Array.isArray(x.c.gallery?.ideas) ? x.c.gallery.ideas : []).map(str).filter(Boolean);
  if (!ideas.length) return "";
  const tiles = ideas
    .map((idea) => `<figure class="tile"><div class="tile-art" role="img" aria-label="${escapeHtml(`${x.t.photoIdea}: ${idea}`)}"></div><figcaption>${escapeHtml(`${x.t.photoIdea}: ${idea}`)}</figcaption></figure>`)
    .join("");
  return `<section id="gallery" aria-labelledby="gallery-title"><div class="container"><h2 id="gallery-title">${escapeHtml(x.t.galleryHeading)}</h2><div class="gallery-grid">${tiles}</div></div></section>`;
}

function testimonials(x: Ctx): string {
  const note = str(x.c.testimonialsNote);
  if (!note) return "";
  return `<section id="testimonials" aria-labelledby="testimonials-title"><div class="container"><h2 id="testimonials-title">${escapeHtml(x.t.testimonialsHeading)}</h2><div class="placeholder"><span class="badge">${escapeHtml(x.t.placeholder)}</span>${paragraphs(note, "muted")}</div></div></section>`;
}

function contactSection(x: Ctx): string {
  const heading = str(x.c.contact?.heading) || x.t.nav.contact;
  const body = str(x.c.contact?.body);
  const phoneText = str(x.contact.phone);
  const address = [str(x.contact.address), str(x.contact.city)].filter(Boolean);
  // Don't repeat the city when the address already contains it.
  const addressText = address.length === 2 && address[0]!.toLowerCase().includes(address[1]!.toLowerCase()) ? address[0]! : address.join(", ");
  const rows = [
    x.links.tel ? `<li><span class="label">${escapeHtml(x.t.phone)}</span>${link(x.links.tel, phoneText)}</li>` : "",
    x.links.wa ? `<li><span class="label">${escapeHtml(x.t.whatsapp)}</span>${link(x.links.wa, x.t.whatsappAction)}</li>` : "",
    x.links.mail ? `<li><span class="label">${escapeHtml(x.t.email)}</span>${link(x.links.mail, x.links.mail.slice(7))}</li>` : "",
    addressText ? `<li><span class="label">${escapeHtml(x.t.address)}</span><span>${escapeHtml(addressText)}</span></li>` : "",
  ].join("");
  const maps = x.links.maps ? `<p class="contact-actions">${link(x.links.maps, x.t.maps, "btn btn-outline")}</p>` : "";
  return `<section class="contact" id="contact" aria-labelledby="contact-title"><div class="container"><h2 id="contact-title">${escapeHtml(heading)}</h2>${paragraphs(body)}${rows ? `<ul class="contact-list">${rows}</ul>` : ""}${maps}</div></section>`;
}

const RENDERERS: Record<ConceptSection, (x: Ctx) => string> = {
  hero,
  services,
  about,
  highlights,
  gallery,
  testimonials,
  contact: contactSection,
};

/* ───────────────────────────── Document ───────────────────────────── */

export function renderConceptHtml(content: ConceptContent, contact: RenderContact, opts: RenderOptions = {}): string {
  const language: ConceptLanguage = opts.language === "fr" ? "fr" : "en";
  const t = LABELS[language];
  const sections = (Array.isArray(content.sections) ? content.sections : [])
    .filter((s, i, all): s is ConceptSection => (CONCEPT_SECTIONS as readonly string[]).includes(s) && all.indexOf(s) === i);
  const name = str(contact.businessName) || str(content.siteTitle);
  const x: Ctx = {
    c: content,
    contact: { ...contact, businessName: name },
    t,
    sections,
    links: {
      tel: telHref(contact.phone),
      wa: whatsappHref(contact.whatsapp),
      mail: mailtoHref(contact.email),
      maps: typeof contact.mapsUrl === "string" && isGoogleMapsUrl(contact.mapsUrl) ? httpsHref(contact.mapsUrl) : null,
    },
  };

  // Sections with nothing to show (e.g. no services) are left out, and so are their nav links.
  const rendered = sections.map((s) => ({ s, html: RENDERERS[s](x) })).filter((r) => r.html !== "");
  const body = rendered.map((r) => r.html);
  const nav = rendered
    .map((r) => r.s)
    .filter((s): s is Exclude<ConceptSection, "hero"> => s !== "hero")
    .map((s) => link(`#${s}`, t.nav[s]))
    .join("");

  const year = Number.isInteger(opts.year) ? (opts.year as number) : new Date().getFullYear();
  const credit = str(opts.footerCredit);
  const siteTitle = str(content.siteTitle) || name;
  const seoTitle = str(content.seo?.title) || siteTitle;
  const meta = str(content.seo?.metaDescription);

  return [
    "<!doctype html>",
    `<html lang="${language}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(seoTitle)}</title>`,
    meta ? `<meta name="description" content="${escapeHtml(meta)}">` : "",
    `<style>${styles(safePalette(content.palette), safePairing(content.typography?.pairing))}</style>`,
    "</head>",
    "<body>",
    `<header class="site-header"><div class="container header-inner"><a class="brand" href="${rendered.some((r) => r.s === "hero") ? "#top" : "#main"}">${escapeHtml(siteTitle)}</a>${nav ? `<nav class="site-nav" aria-label="${escapeHtml(t.navLabel)}">${nav}</nav>` : ""}</div></header>`,
    `<main id="main">${body.join("")}</main>`,
    `<footer class="site-footer"><div class="container"><p>© ${year} ${escapeHtml(name)}</p><p class="muted">${escapeHtml(credit ? t.conceptBy(credit) : t.concept)}</p></div></footer>`,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}
