/**
 * Host helpers: "registrable domain" (eTLD+1) without a full Public Suffix List, and same-site
 * checks. Pure module.
 *
 * The heuristic covers what we meet in practice: generic TLDs (hotel.com), plain ccTLDs (hotel.tg),
 * two-level ccTLD suffixes (hotel.com.gh, hotel.co.uk, hotel.gouv.tg, hotel.co.ci) and the common
 * website-builder suffixes where every customer gets a sub-domain (hotel.wixsite.com).
 */
import { isIP } from "node:net";

/** Second-level labels used under 2-letter country TLDs (com.gh, co.uk, gouv.fr, or.ci, ac.za…). */
const CC_SECOND_LEVEL = new Set([
  "co",
  "com",
  "net",
  "org",
  "gov",
  "gouv",
  "go",
  "edu",
  "ac",
  "or",
  "ne",
  "mil",
  "ltd",
  "plc",
  "sch",
  "nom",
  "asso",
  "presse",
  "int",
]);

/** Hosting platforms where each customer site is a sub-domain (treated like public suffixes). */
const PLATFORM_SUFFIXES = [
  "wixsite.com",
  "business.site",
  "blogspot.com",
  "wordpress.com",
  "github.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "herokuapp.com",
  "webflow.io",
  "squarespace.com",
  "weebly.com",
  "jimdofree.com",
  "jimdosite.com",
  "godaddysites.com",
  "myshopify.com",
  "site123.me",
  "carrd.co",
  "framer.website",
  "odoo.com",
  "wix.com",
];

/** Lower-case, no trailing dot, no "www." prefix. */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h.replace(/\.+$/, "").replace(/^www\./, "");
}

export function registrableDomain(host: string): string {
  const h = normalizeHost(host);
  if (!h || isIP(h)) return h;
  for (const suffix of PLATFORM_SUFFIXES) {
    if (h.endsWith(`.${suffix}`)) {
      const rest = h.slice(0, -(suffix.length + 1));
      const label = rest.slice(rest.lastIndexOf(".") + 1);
      return `${label}.${suffix}`;
    }
  }
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const tld = labels[labels.length - 1]!;
  const sld = labels[labels.length - 2]!;
  if (tld.length === 2 && CC_SECOND_LEVEL.has(sld)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** Same website for page discovery: identical host, ignoring case and "www.". */
export function isSameSiteHost(host: string, siteHosts: Iterable<string>): boolean {
  const h = normalizeHost(host);
  for (const s of siteHosts) if (normalizeHost(s) === h) return true;
  return false;
}
