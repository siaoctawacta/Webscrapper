/**
 * Pick which same-site pages to visit after the homepage: contact pages first, then about pages.
 * Pure module.
 */
import { isSameSiteHost, normalizeHost } from "./domain";
import type { PageLink } from "./extract";

/** Contact-style pages (EN/FR/DE). "contact" also covers contacts/contactez/nous-contacter. */
const CONTACT_RE = /contact|kontakt|impressum/;
/** About-style pages (EN/FR). */
const ABOUT_RE = /about|a-propos|apropos|qui-sommes-nous/;
const NON_PAGE_EXT = /\.(?:pdf|jpe?g|png|gif|svg|webp|avif|zip|rar|docx?|xlsx?|pptx?|mp3|mp4|avi|mov|webm|css|js|json|xml|txt|ics|vcf)$/i;

/** Lower-case, no accents, spaces/underscores as hyphens: "À propos" → "a-propos". */
export function matchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/** Identity of a page for de-duplication: host without www, path without trailing slash, query. */
export function pageKey(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${normalizeHost(u.hostname)}${u.port ? `:${u.port}` : ""}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** 0 = contact page, 1 = about page, null = not interesting. */
export function subpagePriority(link: PageLink): 0 | 1 | null {
  let target = "";
  try {
    const u = new URL(link.url);
    let path = u.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the encoded path
    }
    target = matchKey(`${path}${u.search}`);
  } catch {
    return null;
  }
  const text = matchKey(link.text);
  if (CONTACT_RE.test(target) || CONTACT_RE.test(text)) return 0;
  if (ABOUT_RE.test(target) || ABOUT_RE.test(text)) return 1;
  return null;
}

/**
 * Up to `limit` same-site contact/about page URLs from the homepage links: contact pages first,
 * then about pages, each in document order; never the homepage itself or a file download.
 */
export function selectSubpages(links: PageLink[], opts: { homeUrls: string[]; siteHosts: string[]; limit: number }): string[] {
  if (opts.limit <= 0) return [];
  const seen = new Set(opts.homeUrls.map(pageKey).filter((k): k is string => k !== null));
  const picked: { url: string; priority: 0 | 1; index: number }[] = [];
  links.forEach((link, index) => {
    let u: URL;
    try {
      u = new URL(link.url);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (!isSameSiteHost(u.hostname, opts.siteHosts)) return;
    if (NON_PAGE_EXT.test(u.pathname) || link.url.length > 2048) return;
    const key = pageKey(link.url);
    if (!key || seen.has(key)) return;
    const priority = subpagePriority(link);
    if (priority === null) return;
    seen.add(key);
    picked.push({ url: link.url, priority, index });
  });
  picked.sort((a, b) => a.priority - b.priority || a.index - b.index);
  return picked.slice(0, opts.limit).map((p) => p.url);
}
