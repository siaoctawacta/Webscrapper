/**
 * Pure text helpers shared by normalization, duplicate detection and the sample provider.
 * No secrets, no I/O — safe to import anywhere on the server and in unit tests.
 */

const LIGATURES: Record<string, string> = { œ: "oe", Œ: "OE", æ: "ae", Æ: "AE", ß: "ss", ø: "o", Ø: "O", đ: "d", Đ: "D", ł: "l", Ł: "L" };
const LIGATURE_RE = /[œŒæÆßøØđĐłŁ]/g;

/** Remove diacritics ("Lomé" → "Lome", "Hôtel" → "Hotel", "Œuvre" → "OEuvre"). */
export function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(LIGATURE_RE, (c) => LIGATURES[c] ?? c);
}

/**
 * Case/accent/punctuation-insensitive form: lower-case ASCII-ish words separated by single spaces.
 * Apostrophes split words ("L'Étoile" → "l etoile"), so elided articles can be dropped as stopwords.
 */
export function foldText(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** URL/host-safe slug: "Hôtel Le Palmier d'Or" → "hotel-le-palmier-d-or". */
export function slugify(s: string, maxLength = 40): string {
  const slug = foldText(s)
    .replace(/[^a-z0-9 ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > maxLength / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

/** "web design agency" → "Web Design Agency" (keeps accents: "électricien" → "Électricien"). */
export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("fr") + w.slice(1))
    .join(" ");
}

/** Trimmed string, or null when empty / not a string. Collapses internal whitespace. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

/**
 * Words that carry no identity in a business name: articles/prepositions (FR/EN), legal forms and
 * generic business-type words. "Hôtel Le Palmier" and "Le Palmier" normalize to the same key.
 */
const NAME_STOPWORDS = new Set([
  // articles & prepositions
  "le", "la", "les", "l", "de", "du", "des", "d", "et", "au", "aux", "en", "chez", "the", "of", "and", "a", "an", "at",
  // legal forms
  "sarl", "sarlu", "sa", "sas", "suarl", "ltd", "limited", "llc", "inc", "co", "company", "ets", "etablissement", "etablissements", "plc", "gie",
  // generic business types
  "hotel", "hotels", "hostel", "motel", "auberge", "residence", "lodge", "guest", "house", "guesthouse", "resort", "inn",
  "restaurant", "resto", "maquis", "bar", "cafe", "snack",
  "pharmacie", "pharmacy", "chemist", "clinique", "clinic",
  "salon", "coiffure", "boutique", "shop", "store",
  "supermarche", "supermarket", "superette", "garage", "ecole", "school", "eglise", "church",
]);

/** Name key used for similarity: folded, stopwords removed (falls back to all words if nothing is left). */
export function nameKey(name: string): string {
  const words = foldText(name).split(" ").filter(Boolean);
  const kept = words.filter((w) => !NAME_STOPWORDS.has(w));
  return (kept.length ? kept : words).join(" ");
}

// Reused DP rows (the function is synchronous, so sharing them is safe).
let rowA = new Int32Array(64);
let rowB = new Int32Array(64);

/**
 * Levenshtein distance with an upper bound: returns `max + 1` as soon as the distance is known to
 * exceed `max` (banded dynamic programming, O(max · n), no allocation in the hot path).
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  const BIG = max + 1;
  if (Math.abs(la - lb) > max) return BIG;
  if (la === 0) return lb <= max ? lb : BIG;
  if (lb === 0) return la <= max ? la : BIG;
  if (rowA.length < lb + 2) {
    rowA = new Int32Array(lb + 2);
    rowB = new Int32Array(lb + 2);
  }
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= lb; j++) prev[j] = j <= max ? j : BIG;
  prev[lb + 1] = BIG;
  for (let i = 1; i <= la; i++) {
    const from = Math.max(1, i - max);
    const to = Math.min(lb, i + max);
    cur[0] = i <= max ? i : BIG;
    if (from > 1) cur[from - 1] = BIG;
    let rowMin = from > 1 ? BIG : cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = from; j <= to; j++) {
      const sub = prev[j - 1]! + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      const del = prev[j]! + 1;
      const ins = cur[j - 1]! + 1;
      let v = sub < del ? sub : del;
      if (ins < v) v = ins;
      if (v > BIG) v = BIG;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (to < lb) cur[to + 1] = BIG;
    if (rowMin > max) return BIG;
    const t = prev;
    prev = cur;
    cur = t;
  }
  const d = prev[lb]!;
  return d > max ? BIG : d;
}

/** Similarity in [0, 1] from Levenshtein distance; values below `min` may be reported as 0. */
export function stringSimilarity(a: string, b: string, min = 0): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const allowed = Math.floor((1 - min) * maxLen + 1e-9);
  const d = boundedLevenshtein(a, b, allowed);
  if (d > allowed) return 0;
  return 1 - d / maxLen;
}

/** Name key with its words sorted, for order-insensitive comparison. */
export const sortedWords = (k: string) => (k.includes(" ") ? k.split(" ").sort().join(" ") : k);

/**
 * Business-name similarity in [0, 1]: accent/case/punctuation-insensitive, ignores common words
 * (hotel/hôtel, le/la, SARL…) and word order ("Palmier d'Or Hôtel" ≈ "Hôtel Le Palmier d'Or").
 * Pass precomputed `nameKey()` values with `keysGiven` for hot loops.
 */
export function nameSimilarity(a: string, b: string, opts: { min?: number; keysGiven?: boolean } = {}): number {
  const ka = opts.keysGiven ? a : nameKey(a);
  const kb = opts.keysGiven ? b : nameKey(b);
  if (!ka || !kb) return 0;
  const min = opts.min ?? 0;
  const direct = stringSimilarity(ka, kb, min);
  if (direct === 1 || (!ka.includes(" ") && !kb.includes(" "))) return direct;
  return Math.max(direct, stringSimilarity(sortedWords(ka), sortedWords(kb), min));
}
