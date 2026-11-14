/**
 * Contact links for proposals. Pure module (safe on client and server).
 */

const SIMPLE_EMAIL = /^[^\s@?&#<>"',;:]+@[^\s@?&#<>"',;:]+\.[^\s@?&#<>"',;:]+$/;

/** The address only when it is safe to put in a mailto: link as-is; otherwise null. */
export function mailtoAddress(email: string | null | undefined): string | null {
  const e = email?.trim();
  return e && SIMPLE_EMAIL.test(e) ? e : null;
}

/** mailto: link with encoded subject and body. */
export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** wa.me link: digits of the E.164 number, message pre-filled. */
export function whatsappUrl(digits: string, text: string): string {
  return `https://wa.me/${digits.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
