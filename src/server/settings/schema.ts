/**
 * Validation for the sender profile (PUT /api/v1/me/settings). Pure module (no DB, no secrets).
 *
 * Semantics: a key that is absent is left unchanged; `null` or an empty string clears it.
 */
import { z } from "zod";
import { LANGUAGES } from "@/lib/domain";

export const SENDER_TEXT_MAX = 200;
export const SIGNATURE_MAX = 1000;

// Control characters (except tab/newline) are never useful here and NUL breaks Postgres text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: string) => v.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");

/** Optional, nullable text: trimmed, control characters removed, "" → null. */
function text(label: string, max = SENDER_TEXT_MAX, opts: { multiline?: boolean } = {}) {
  return z
    .string({ error: `${label} must be text` })
    .transform((v) => {
      const c = clean(v).trim();
      return opts.multiline ? c : c.replace(/\s*\n\s*/g, " ");
    })
    .pipe(z.string().max(max, { error: `${label} must be ${max} characters or fewer` }))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
}

const email = text("Email").refine((v) => v == null || z.email().safeParse(v).success, {
  error: "Enter a valid email address, like name@company.com",
});

const phone = text("Phone").refine((v) => v == null || (v.match(/\d/g)?.length ?? 0) >= 6, {
  error: "Enter a phone number with at least 6 digits",
});

/** Has an explicit scheme ("https://…", "javascript:…", "mailto:…") as opposed to "site.com" or "site.com:8080". */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * Web address: http(s) only. A bare domain ("monsite.tg") gets "https://" in front.
 * Returns the address as stored (with scheme), or an issue.
 */
export function normalizeWebUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const withScheme = HAS_SCHEME.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, message: "must be a valid web address, like https://yourstudio.com" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, message: "must start with http:// or https://" };
  if (!u.hostname.includes(".") || u.hostname.startsWith(".") || u.hostname.endsWith(".")) {
    return { ok: false, message: "must be a valid web address, like https://yourstudio.com" };
  }
  if (u.username || u.password) return { ok: false, message: "must not contain a username or password" };
  if (/\s/.test(withScheme)) return { ok: false, message: "must not contain spaces" };
  return { ok: true, url: withScheme };
}

function webUrl(label: string) {
  return text(label).transform((v, ctx) => {
    if (v == null) return v;
    const r = normalizeWebUrl(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: `${label} ${r.message}` });
      return z.NEVER;
    }
    return r.url;
  });
}

export const senderProfileInputSchema = z.object({
  senderName: text("Name"),
  senderCompany: text("Company"),
  senderEmail: email,
  senderPhone: phone,
  senderWebsite: webUrl("Website"),
  senderPortfolioUrl: webUrl("Portfolio link"),
  signature: text("Signature", SIGNATURE_MAX, { multiline: true }),
  defaultLanguage: z.enum(LANGUAGES, { error: "Choose English or French" }).optional(),
});

export type SenderProfileInput = z.infer<typeof senderProfileInputSchema>;
