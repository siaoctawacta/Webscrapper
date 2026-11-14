import type { SenderProfile } from "@/lib/api-types";
import type { Language } from "@/lib/domain";

/** "https://www.studio.tg/" → "studio.tg" for display. */
export function displayUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

export const CLOSING: Record<Language, string> = { en: "Best regards,", fr: "Cordialement," };

type SignatureSource = Pick<
  SenderProfile,
  "senderName" | "senderCompany" | "senderEmail" | "senderPhone" | "senderWebsite" | "senderPortfolioUrl"
>;

/** Lines built from the sender's details: name, company, phone · email, website, portfolio. */
export function composeSignatureLines(p: SignatureSource): string[] {
  const contact = [p.senderPhone, p.senderEmail].map((v) => v?.trim()).filter(Boolean).join(" · ");
  return [
    p.senderName,
    p.senderCompany,
    contact,
    displayUrl(p.senderWebsite),
    p.senderPortfolioUrl ? `Portfolio: ${displayUrl(p.senderPortfolioUrl)}` : null,
  ]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
}

/** What a proposal will end with: the saved signature if there is one, otherwise the composed details. */
export function signatureLines(p: SignatureSource & { signature: string | null }): { lines: string[]; source: "signature" | "details" | "none" } {
  const own = p.signature?.trim();
  if (own) return { lines: own.split("\n").map((l) => l.trimEnd()), source: "signature" };
  const composed = composeSignatureLines(p);
  return { lines: composed, source: composed.length ? "details" : "none" };
}
