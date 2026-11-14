/**
 * Extract published contact details and simple site-health signals from one HTML page (cheerio).
 * Website content is untrusted data: we only pattern-match it, never execute or interpret it.
 * Pure module.
 */
import { load, type CheerioAPI } from "cheerio";
import type { Socials } from "@/lib/domain";
import { cfEmailFromHref, decodeCfEmail, findObfuscatedEmails, findTextEmails, normalizeEmailCandidate } from "./emails";
import { collectSocials } from "./socials";

export type PageLink = { url: string; text: string };

export type PageExtraction = {
  /** Normalized addresses in the order found: mailto, Cloudflare, JSON-LD, visible text, obfuscated. */
  emails: string[];
  socials: Socials;
  /** tel: links, raw (as published), de-duplicated by digits. */
  phones: string[];
  /** Absolute http(s) links without #fragment, with their visible text. */
  links: PageLink[];
  title: string | null;
  mobileViewport: boolean;
  copyrightYear: number | null;
};

const MAX_TITLE_CHARS = 200;
const MAX_LINK_TEXT = 200;
const MAX_PHONES_PER_PAGE = 10;
export const MIN_COPYRIGHT_YEAR = 1995;

/** Tags whose content is never visible text. */
const SKIP_TAGS = new Set(["script", "style", "template", "head", "svg", "math", "iframe", "object", "noembed", "noframes", "select"]);
/** Tags that start a new line of text (so "<p>Call</p><p>a@b.tg</p>" doesn't glue words together). */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "button",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
  "img",
  "input",
  "label",
]);

/**
 * domhandler (cheerio's DOM) is not a direct dependency, so its node types are described
 * structurally here; only these fields are read.
 */
type DomNode = { type: string; name?: string; data?: string; children?: DomNode[] };

const INVISIBLE_CHARS = /[​-‍⁠﻿­]/g;

/** Visible text of the <body>, with line breaks at block boundaries. */
export function visibleText($: CheerioAPI): string {
  const body = $("body")[0] as unknown as DomNode | undefined;
  const root = body ?? ($.root()[0] as unknown as DomNode);
  const out: string[] = [];
  const stack: (DomNode | "\n")[] = [root];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item === "\n") {
      out.push("\n");
      continue;
    }
    if (item.type === "text") {
      out.push(item.data ?? "");
      continue;
    }
    if (item.type !== "tag" && item.type !== "root") continue; // comments, scripts, styles, directives
    const name = item.name?.toLowerCase();
    if (name && SKIP_TAGS.has(name)) continue;
    const block = name ? BLOCK_TAGS.has(name) : false;
    if (block) {
      out.push("\n");
      stack.push("\n");
    }
    const children = item.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return out
    .join("")
    .replace(INVISIBLE_CHARS, "")
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n");
}

/** Latest plausible year next to a "©" / "(c)" / "Copyright" marker, on the marker's line. */
export function findCopyrightYear(text: string, currentYear = new Date().getFullYear()): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/©|&copy;|\(c\)|copyright/gi)) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const before = text.slice(Math.max(lineStart, m.index - 12), m.index);
    const afterStart = m.index + m[0].length;
    const lineEnd = text.indexOf("\n", afterStart);
    const after = text.slice(afterStart, Math.min(lineEnd === -1 ? text.length : lineEnd, afterStart + 60));
    for (const y of `${before} ${after}`.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)) {
      const year = Number(y[0]);
      if (year >= MIN_COPYRIGHT_YEAR && year <= currentYear && (best === null || year > best)) best = year;
    }
  }
  return best;
}

function collapse(s: string, max: number): string {
  const t = s.replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : t;
}

/** tel: href → the number as published, or null when it doesn't look like a phone number. */
export function phoneFromTelHref(href: string): string | null {
  let raw = href.replace(/^tel:/i, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw text
  }
  raw = (raw.replace(/^\/\//, "").split(/[?;,]/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (!raw || !/^[+\d\s().\-/]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return raw;
}

function pageBase($: CheerioAPI, pageUrl: string): string {
  const declared = $("base[href]").first().attr("href");
  if (declared) {
    try {
      const b = new URL(declared, pageUrl);
      if (b.protocol === "http:" || b.protocol === "https:") return b.href;
    } catch {
      // ignore an invalid <base>
    }
  }
  return pageUrl;
}

function absoluteHttpUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Emails and sameAs links from JSON-LD blocks (schema.org Organization / LocalBusiness). */
function jsonLd($: CheerioAPI): { emails: string[]; sameAs: string[] } {
  const emails: string[] = [];
  const sameAs: string[] = [];
  $("script[type]").each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (!type.includes("ld+json")) return;
    let data: unknown;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return;
    }
    let budget = 2000;
    const stack: { v: unknown; depth: number }[] = [{ v: data, depth: 0 }];
    while (stack.length > 0 && budget-- > 0) {
      const { v, depth } = stack.pop()!;
      if (depth > 10 || v === null || typeof v !== "object") continue;
      if (Array.isArray(v)) {
        for (const x of v) stack.push({ v: x, depth: depth + 1 });
        continue;
      }
      for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
        const k = key.toLowerCase();
        const strings = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
        if (k === "email") emails.push(...strings);
        else if (k === "sameas") sameAs.push(...strings);
        if (typeof value === "object" && value !== null) stack.push({ v: value, depth: depth + 1 });
      }
    }
  });
  return { emails, sameAs };
}

function pageTitle($: CheerioAPI): string | null {
  const el = $("title")
    .filter((_, t) => $(t).parents("svg").length === 0)
    .first();
  const title = el.length ? collapse(el.text(), MAX_TITLE_CHARS) : "";
  return title || null;
}

function hasMobileViewport($: CheerioAPI): boolean {
  return $("meta[name]")
    .toArray()
    .some((el) => {
      const name = ($(el).attr("name") ?? "").trim().toLowerCase();
      return name === "viewport" && /width\s*=\s*device-width/i.test($(el).attr("content") ?? "");
    });
}

export function extractPage(html: string, pageUrl: string, opts: { currentYear?: number } = {}): PageExtraction {
  const $ = load(html);
  const base = pageBase($, pageUrl);

  const emails: string[] = [];
  const pushEmail = (raw: string | null) => {
    const e = raw ? normalizeEmailCandidate(raw) : null;
    if (e && !emails.includes(e)) emails.push(e);
  };
  const phones: string[] = [];
  const phoneDigits = new Set<string>();
  const socialHrefs: string[] = [];
  const links: PageLink[] = [];

  $("a[href], area[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href) return;
    if (/^mailto:/i.test(href)) return pushEmail(href);
    if (/^tel:/i.test(href)) {
      const p = phoneFromTelHref(href);
      const digits = p?.replace(/\D/g, "");
      if (p && digits && !phoneDigits.has(digits) && phones.length < MAX_PHONES_PER_PAGE) {
        phoneDigits.add(digits);
        phones.push(p);
      }
      return;
    }
    const cf = cfEmailFromHref(href);
    if (cf) return pushEmail(cf);
    socialHrefs.push(href);
    const abs = absoluteHttpUrl(href, base);
    if (abs) {
      const text = collapse($(el).text(), MAX_LINK_TEXT) || collapse($(el).attr("title") ?? $(el).attr("aria-label") ?? "", MAX_LINK_TEXT);
      links.push({ url: abs, text });
    }
  });

  $("[data-cfemail]").each((_, el) => pushEmail(decodeCfEmail($(el).attr("data-cfemail") ?? "")));

  const ld = jsonLd($);
  for (const e of ld.emails) pushEmail(e);

  const text = visibleText($);
  for (const e of findTextEmails(text)) pushEmail(e);
  for (const e of findObfuscatedEmails(text)) pushEmail(e);

  const socials = collectSocials([...socialHrefs, ...ld.sameAs], base);

  return {
    emails,
    socials,
    phones,
    links,
    title: pageTitle($),
    mobileViewport: hasMobileViewport($),
    copyrightYear: findCopyrightYear(text, opts.currentYear),
  };
}
