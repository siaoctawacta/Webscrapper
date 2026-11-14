/** Phone normalization with libphonenumber-js (pure, no I/O). */
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { VerificationStatus } from "@/lib/domain";
import { cleanText } from "./text";

export type NormalizedPhone = {
  /** As provided: international format when the provider gives one, else national. */
  phoneRaw: string | null;
  /** E.164 ("+22890123456") — only when the number parses as valid for its country. */
  phoneE164: string | null;
  /** Digits of the E.164 number, else digits of the raw value (for sorting). */
  phoneDigits: string | null;
  /** source_provided = present and valid; needs_review = present but not valid; unknown = absent. */
  phoneStatus: VerificationStatus;
};

/** ISO alpha-2 country code usable by libphonenumber, or undefined. */
export function phoneCountry(countryCode: string | null | undefined): CountryCode | undefined {
  if (!countryCode) return undefined;
  const cc = countryCode.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) && isSupportedCountry(cc) ? (cc as CountryCode) : undefined;
}

/** Parse one raw value; returns the E.164 form only when valid. */
export function parseValidPhone(raw: string, country: CountryCode | undefined): string | null {
  const parsed = parsePhoneNumberFromString(raw, country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

const digits = (s: string) => s.replace(/\D+/g, "");

/**
 * Normalize provider phone fields. Never invents a number: when the value does not parse as a valid
 * number for the country it is kept as provided and flagged `needs_review`.
 */
export function normalizePhone(international: string | null | undefined, national: string | null | undefined, countryCode: string | null | undefined): NormalizedPhone {
  const intl = cleanText(international);
  const nat = cleanText(national);
  const raw = intl ?? nat;
  if (!raw) return { phoneRaw: null, phoneE164: null, phoneDigits: null, phoneStatus: "unknown" };
  const country = phoneCountry(countryCode);
  let e164: string | null = null;
  for (const candidate of [intl, nat]) {
    if (!candidate) continue;
    e164 = parseValidPhone(candidate, country);
    if (e164) break;
  }
  const rawDigits = digits(raw);
  return {
    phoneRaw: raw,
    phoneE164: e164,
    phoneDigits: e164 ? digits(e164) : rawDigits || null,
    phoneStatus: e164 ? "source_provided" : "needs_review",
  };
}
