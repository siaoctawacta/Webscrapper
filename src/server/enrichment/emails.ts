/**
 * Email extraction helpers: find addresses a business published on its own website, decode common
 * anti-spam encodings, drop junk (asset names, placeholders, tracking ids) and rank the rest.
 * Never guesses or builds an address that is not literally published. Pure module.
 */
import type { FoundEmail } from "@/lib/domain";
import { registrableDomain } from "./domain";

export const MAX_EMAILS = 5;
const MAX_EMAIL_LENGTH = 254;

/** File extensions that show up as fake "TLDs" (logo@2x.png, app@1.2.js) or are not real mail domains. */
const ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "css",
  "js",
  "mjs",
  "map",
  "json",
  "xml",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pdf",
  "mp3",
  "mp4",
  "webm",
  "mov",
  "avi",
  "zip",
  "rar",
  "gz",
  "php",
  "html",
  "htm",
  "asp",
  "aspx",
  "jsp",
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

/** Reserved / non-public TLDs (RFC 2606, RFC 6761) and common intranet suffixes. */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local", "internal", "lan", "home", "corp", "intranet", "localdomain"]);

/** Exact domains used as placeholders in templates and docs. */
const PLACEHOLDER_DOMAINS = new Set([
  "domain.com",
  "domaine.com",
  "yourdomain.com",
  "your-domain.com",
  "mydomain.com",
  "votredomaine.com",
  "votre-domaine.com",
  "email.com",
  "website.com",
  "yoursite.com",
  "yourwebsite.com",
  "mysite.com",
  "monsite.com",
  "company.com",
  "yourcompany.com",
  "test.com",
  "sentry.io",
  "wixpress.com",
]);

/** Domain labels/fragments that mark a placeholder or a vendor's internal address. */
const PLACEHOLDER_DOMAIN_LABELS = new Set(["example", "exemple"]);
const VENDOR_DOMAIN_FRAGMENTS = ["sentry", "wixpress", "godaddy", "cloudflare"];

/** Local parts that are placeholders (EN/FR templates) or never a contact address. */
const PLACEHOLDER_LOCAL_PARTS = new Set([
  "yourname",
  "your.name",
  "your-name",
  "your_name",
  "youremail",
  "your.email",
  "your-email",
  "yourmail",
  "name",
  "firstname",
  "lastname",
  "firstname.lastname",
  "first.last",
  "prenom",
  "nom",
  "prenom.nom",
  "nom.prenom",
  "votrenom",
  "votre.nom",
  "votreemail",
  "votre.email",
  "votre-email",
  "votremail",
  "user",
  "username",
  "test",
  "testing",
  "sample",
  "someone",
  "somebody",
  "john",
  "johndoe",
  "john.doe",
  "jane.doe",
  "janedoe",
  "xxx",
  "xxxx",
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
]);

const LOCAL_RE = /^[a-z0-9._%+-]{1,64}$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$/;

/** Syntax check on an already lower-cased address (conservative ASCII subset). */
export function isValidEmailSyntax(email: string): boolean {
  if (email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!LOCAL_RE.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || domain.length > 253) return false;
  if (!labels.every((l) => LABEL_RE.test(l))) return false;
  const tld = labels[labels.length - 1]!;
  return TLD_RE.test(tld);
}

/** Asset file names and version strings that look like emails (logo@2x.png, lib@1.2.3). */
export function isAssetLike(email: string): boolean {
  const domain = email.slice(email.indexOf("@") + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (ASSET_EXTENSIONS.has(tld)) return true;
  // Retina image suffixes: icon@2x.png, banner@3x.webp, image@1.5x.jpg
  if (/^\d+(?:\.\d+)?x(?:\.|$)/.test(domain)) return true;
  return false;
}

export function isPlaceholderEmail(email: string): boolean {
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld)) return true;
  if (PLACEHOLDER_LOCAL_PARTS.has(local)) return true;
  if (PLACEHOLDER_DOMAINS.has(domain) || [...PLACEHOLDER_DOMAINS].some((d) => domain.endsWith(`.${d}`))) return true;
  if (domain.split(".").some((l) => PLACEHOLDER_DOMAIN_LABELS.has(l))) return true;
  if (VENDOR_DOMAIN_FRAGMENTS.some((f) => domain.includes(f))) return true;
  // Tracking / error-reporting ids such as 605a7baede844d278b89dc95ae0a9123@…
  if (/^[a-f0-9]{24,}$/.test(local)) return true;
  return false;
}

/**
 * Normalize one raw candidate (a `mailto:` href, a text match, a JSON-LD value) to a lower-cased
 * address, or null when it is not a usable published email.
 */
export function normalizeEmailCandidate(raw: string): string | null {
  let s = raw.trim();
  if (/^mailto:/i.test(s)) s = s.slice(7);
  // mailto:a@b.com?subject=… / #… — and a list "a@b.com,c@d.com" keeps only the first.
  s = s.split(/[?#]/)[0] ?? "";
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      return null;
    }
  }
  s = s.split(/[,;\s]/).find((p) => p.includes("@")) ?? "";
  s = s.replace(/^[<("'[\s]+/, "").replace(/[>)"'\].,;:!?\s]+$/, "").toLowerCase();
  if (!s || !isValidEmailSyntax(s)) return null;
  if (isAssetLike(s) || isPlaceholderEmail(s)) return null;
  return s;
}

/** Cloudflare "email protection": first byte is the XOR key for the remaining bytes (UTF-8). */
export function decodeCfEmail(hex: string): string | null {
  const h = hex.trim();
  if (h.length < 4 || h.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(h)) return null;
  const key = Number.parseInt(h.slice(0, 2), 16);
  const bytes = new Uint8Array(h.length / 2 - 1);
  for (let i = 2; i < h.length; i += 2) bytes[i / 2 - 1] = Number.parseInt(h.slice(i, i + 2), 16) ^ key;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Hex payload of a Cloudflare protected link: /cdn-cgi/l/email-protection#<hex>. */
export function cfEmailFromHref(href: string): string | null {
  const m = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i.exec(href);
  return m ? decodeCfEmail(m[1]!) : null;
}

const TEXT_EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+/gi;

/** Plain addresses in visible text. */
export function findTextEmails(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TEXT_EMAIL_RE)) {
    // Skip matches glued to a preceding address-ish character (e.g. part of a longer token).
    const before = m.index > 0 ? text[m.index - 1] : "";
    if (before && /[a-z0-9._%+-]/i.test(before)) continue;
    const e = normalizeEmailCandidate(m[0]);
    if (e) out.push(e);
  }
  return out;
}

// "name [at] domain [dot] com", "name (at) domain (dot) com", "{at}", "[arobase]", "(point)" (FR).
const OPEN = String.raw`[\[\(\{<]`;
const CLOSE = String.raw`[\]\)\}>]`;
const AT_TOKEN = String.raw`\s*${OPEN}\s*(?:at|@|arobase)\s*${CLOSE}\s*`;
const DOT_TOKEN = String.raw`(?:\s*${OPEN}\s*(?:dot|point)\s*${CLOSE}\s*|\.)`;
const OBFUSCATED_RE = new RegExp(
  String.raw`([a-z0-9._%+-]{1,64})${AT_TOKEN}([a-z0-9-]{1,63}(?:${DOT_TOKEN}[a-z0-9-]{1,63})+)`,
  "gi",
);
const DOT_TOKEN_RE = new RegExp(String.raw`\s*${OPEN}\s*(?:dot|point)\s*${CLOSE}\s*`, "gi");

/** Addresses written with "[at]" / "(at)" / "[dot]" style obfuscation. */
export function findObfuscatedEmails(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const local = m[1]!;
    const domain = m[2]!.replace(DOT_TOKEN_RE, ".");
    const e = normalizeEmailCandidate(`${local}@${domain}`);
    if (e) out.push(e);
  }
  return out;
}

export function emailDomainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/**
 * De-duplicate (first occurrence keeps its source page), flag addresses on the site's own
 * registrable domain, put those first (stable), keep at most `max`.
 */
export function rankEmails(found: { email: string; sourceUrl: string }[], siteHosts: string[], max = MAX_EMAILS): FoundEmail[] {
  const siteDomains = new Set(siteHosts.map(registrableDomain).filter(Boolean));
  const seen = new Set<string>();
  const unique: FoundEmail[] = [];
  for (const f of found) {
    const email = f.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    unique.push({ email, sourceUrl: f.sourceUrl, sameDomain: siteDomains.has(registrableDomain(emailDomainOf(email))) });
  }
  const same = unique.filter((e) => e.sameDomain);
  const others = unique.filter((e) => !e.sameDomain);
  return [...same, ...others].slice(0, max);
}
