/**
 * Checks an AI rewrite against the template draft it was based on. Pure module.
 *
 * The model is told not to add facts; this verifies the parts we can check mechanically:
 * no new links, email addresses or numbers, the signature kept, and no leftover placeholders.
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+/gi;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
const DIGITS_RE = /\d+/g;
const PLACEHOLDER_RE = /\[[^\]\n]*\]|\{\{?[^}\n]*\}\}?|<[^>\n]*>|\b(?:undefined|null|NaN)\b/;

const strip = (s: string) => s.replace(/[.,;:!?)\]]+$/, "").toLowerCase();
const tokens = (text: string, re: RegExp) => new Set((text.match(re) ?? []).map(strip));

export type GuardResult = { ok: true } | { ok: false; problem: string };

export function checkAiRewrite(draft: { subject: string; body: string }, ai: { subject: string; body: string }, requiredLines: string[]): GuardResult {
  const source = `${draft.subject}\n${draft.body}`;
  const out = `${ai.subject}\n${ai.body}`;

  for (const [re, what] of [
    [URL_RE, "link"],
    [EMAIL_RE, "email address"],
    [DOMAIN_RE, "web address"],
    [DIGITS_RE, "number"],
  ] as const) {
    const allowed = tokens(source, re);
    for (const t of tokens(out, re)) {
      if (!allowed.has(t)) return { ok: false, problem: `added a ${what} that isn't in the draft` };
    }
  }
  // Links from the draft (e.g. the shared concept) must survive.
  for (const url of tokens(draft.body, URL_RE)) {
    if (!out.toLowerCase().includes(url)) return { ok: false, problem: "dropped a link" };
  }
  for (const line of requiredLines) {
    const l = line.trim();
    if (l && !ai.body.includes(l)) return { ok: false, problem: "changed the signature" };
  }
  if (PLACEHOLDER_RE.test(out) && !PLACEHOLDER_RE.test(source)) return { ok: false, problem: "left a placeholder" };
  return { ok: true };
}
