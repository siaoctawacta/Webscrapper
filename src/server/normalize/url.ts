/** Pure URL helpers (no I/O). */

/**
 * Lower-case hostname without a leading "www." (and without a trailing dot), or null when the
 * value is not a usable http(s) URL. Accepts bare domains such as "www.example.com/contact".
 */
export function websiteHostOf(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const raw = url.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw.replace(/^\/+/, "")}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || !host.includes(".")) return null;
  return host;
}

/** Domain part of an email address, lower-cased ("Info@Hotel.example" → "hotel.example"). */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, "") || null;
}

/** Loose syntactic check used before storing a provider-supplied email (no guessing, no repair). */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]{2,}$/.test(v);
}

/**
 * Hosts shared by many unrelated businesses (social networks, link-in-bio pages, site builders that
 * use paths, map/booking platforms). Two listings pointing at e.g. facebook.com are NOT duplicates.
 */
const SHARED_HOSTS = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "twitter.com", "x.com", "tiktok.com", "youtube.com", "youtu.be",
  "linkedin.com", "wa.me", "whatsapp.com", "t.me", "telegram.me", "snapchat.com", "pinterest.com",
  "linktr.ee", "linktree.com", "beacons.ai", "bit.ly", "goo.gl", "tinyurl.com",
  "google.com", "sites.google.com", "g.page", "business.site", "maps.app.goo.gl",
  "tripadvisor.com", "tripadvisor.fr", "booking.com", "airbnb.com", "expedia.com", "hotels.com", "agoda.com",
  "jumia.com", "jumia.com.gh", "jumia.ci", "yelp.com", "pagesjaunes.fr", "wixsite.com", "blogspot.com", "wordpress.com",
  // .example equivalents used by the sample provider
  "facebook.example", "instagram.example", "x.example", "tiktok.example", "youtube.example", "linkedin.example",
  "wa.example", "mail.example",
];
const SHARED_SET = new Set(SHARED_HOSTS);

/** True for hosts that cannot identify a single business (see SHARED_HOSTS). */
export function isSharedPlatformHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  if (SHARED_SET.has(h)) return true;
  // Sub-domains of path-based platforms (m.facebook.com, web.facebook.com, business.google.com…).
  for (const s of ["facebook.com", "instagram.com", "google.com", "linkedin.com", "youtube.com", "tiktok.com", "twitter.com", "x.com", "whatsapp.com"]) {
    if (h.endsWith(`.${s}`)) return true;
  }
  return false;
}
