/**
 * Lead tag rules (pure, no I/O): trimmed, inner whitespace collapsed, user casing kept,
 * de-duplicated case-insensitively (first spelling wins), at most MAX_TAGS × MAX_TAG_LENGTH.
 */

export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 40;

export class TagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagError";
  }
}

/** Trim and collapse inner whitespace. Returns "" for blank input. */
export function cleanTag(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Normalize a list of tags. Throws TagError when a tag is longer than MAX_TAG_LENGTH or when more
 * than MAX_TAGS distinct tags remain (the caller turns it into a 422 with the message).
 */
export function normalizeTags(input: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = cleanTag(raw);
    if (!tag) continue;
    if ([...tag].length > MAX_TAG_LENGTH) {
      throw new TagError(`Tags can be at most ${MAX_TAG_LENGTH} characters (“${[...tag].slice(0, MAX_TAG_LENGTH).join("")}…” is too long).`);
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > MAX_TAGS) throw new TagError(`A lead can have at most ${MAX_TAGS} tags.`);
  return out;
}
