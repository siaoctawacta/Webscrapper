/**
 * Link builders for the concept page. Pure module.
 *
 * The renderer only ever emits https:, tel:, mailto: and https://wa.me/ links, and only from the
 * user-confirmed contact block — every builder returns null for anything else.
 */
import { digitsOf } from "./schema";

export type ContactLinkSource = {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  mapsUrl?: string | null;
};

const PHONE_CHARS = /^\+?[0-9 ().-]{4,40}$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** `tel:+22890123456` from a display number; null unless it looks like a phone number. */
export function telHref(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const p = phone.trim();
  if (!PHONE_CHARS.test(p)) return null;
  const digits = digitsOf(p);
  if (digits.length < 6 || digits.length > 15) return null;
  return `tel:${p.startsWith("+") ? "+" : ""}${digits}`;
}

/** `https://wa.me/<digits>` (international number, digits only); null when unusable. */
export function whatsappHref(number: string | null | undefined): string | null {
  if (typeof number !== "string") return null;
  const p = number.trim();
  if (!PHONE_CHARS.test(p)) return null;
  const digits = digitsOf(p);
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}

/** `mailto:` for a syntactically valid address; null otherwise. */
export function mailtoHref(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  return `mailto:${e}`;
}

/** A normalised https URL without credentials; null for any other scheme. */
export function httpsHref(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
  return u.toString();
}

/** Where the hero's primary button goes: WhatsApp first (most used locally), then phone, then the contact section. */
export type CtaTarget = "whatsapp" | "phone" | "contact";

export function ctaTarget(contact: ContactLinkSource): CtaTarget {
  if (whatsappHref(contact.whatsapp)) return "whatsapp";
  if (telHref(contact.phone)) return "phone";
  return "contact";
}

/** Final allowlist check on any href written into the page. */
export function isAllowedHref(href: string): boolean {
  if (href.startsWith("#")) return /^#[a-z][a-z0-9-]*$/.test(href);
  if (href.startsWith("tel:")) return /^tel:\+?\d{6,15}$/.test(href);
  if (href.startsWith("mailto:")) return EMAIL_RE.test(href.slice(7));
  if (href.startsWith("https://")) return httpsHref(href) !== null;
  return false;
}
