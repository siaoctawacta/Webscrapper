/**
 * Spreadsheet formula-injection protection (pure — no secrets, no DB).
 *
 * Spreadsheet apps (Excel, LibreOffice, Google Sheets) evaluate a text cell as a formula when it
 * starts with "=", "+", "-" or "@", and some also act on a leading tab or carriage return. Business
 * names, notes, tags and website text are untrusted, so every string cell we write is neutralised:
 *
 * - ASCII control characters are removed (newline \n is kept so multi-line notes survive);
 * - a dangerous value is prefixed with a single quote ('), which every spreadsheet shows as text.
 *
 * Phone numbers and plain numbers such as "+228 90 12 34 56" or "-5" are not dangerous and are kept
 * exactly as they are, so leading "+" and leading zeros are never lost.
 */

/** Characters 0x00–0x1F and 0x7F, except the line feed (0x0A). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

/** "+228 90 12 34 56", "-5", "+1 (555) 010-0000", "-12.5" — signs followed only by digits and separators. */
const PHONE_OR_NUMBER_LIKE = /^[+-][\d\s().\-/]*$/;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

function startsDangerously(value: string): boolean {
  const first = value[0];
  if (first === undefined) return false;
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return true;
  if (first === "+" || first === "-") return !PHONE_OR_NUMBER_LIKE.test(value);
  return false;
}

/**
 * True when a spreadsheet could interpret the text as a formula or command. Checks the raw value,
 * the value without control characters, and the value without leading spaces (some importers trim).
 */
export function isDangerousCellText(value: string): boolean {
  const cleaned = stripControlChars(value);
  return startsDangerously(value) || startsDangerously(cleaned) || startsDangerously(cleaned.trimStart());
}

/** Neutralise one text cell: strip control characters and prefix "'" when it could run as a formula. */
export function sanitizeCellText(value: string): string {
  const cleaned = stripControlChars(value);
  return isDangerousCellText(value) ? `'${cleaned}` : cleaned;
}
