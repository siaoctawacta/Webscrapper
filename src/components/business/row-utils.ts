/**
 * Pure helpers for reading and presenting a BusinessRow in the UI (isomorphic, no React).
 * `fieldValue` mirrors `rowValue` in src/server/rows.ts (which is server-only).
 */
import type { BusinessRow, SourcePolicyInfo } from "@/lib/api-types";
import type { FoundEmail, SourceId } from "@/lib/domain";
import type { FieldKey } from "@/lib/fields";
import { SOURCE_ATTRIBUTION, SOURCE_LABELS } from "./labels";

/** Raw value behind a field key for one row. */
export function fieldValue(row: BusinessRow, key: FieldKey): unknown {
  switch (key) {
    case "business_name":
      return row.name;
    case "category":
      return row.category;
    case "phone":
      return row.phone;
    case "website":
      return row.website;
    case "website_status":
      return row.websiteStatus;
    case "email":
      return row.email;
    case "email_status":
      return row.emailStatus;
    case "address":
      return row.address;
    case "city":
      return row.city;
    case "region":
      return row.region;
    case "country":
      return row.country;
    case "postal_code":
      return row.postalCode;
    case "rating":
      return row.rating;
    case "review_count":
      return row.reviewCount;
    case "maps_url":
      return row.mapsUrl;
    case "latitude":
      return row.lat;
    case "longitude":
      return row.lng;
    case "socials":
      return row.socials;
    case "business_status":
      return row.businessStatus;
    case "quality_status":
      return row.qualityStatus;
    case "phone_status":
      return row.phoneStatus;
    case "source":
      return row.source;
    case "source_record_id":
      return row.sourceRecordId;
    case "retrieved_at":
      return row.retrievedAt;
    case "last_verified":
      return row.lastVerifiedAt;
    case "lead_status":
      return row.lead?.status ?? null;
    case "tags":
      return row.lead?.tags ?? null;
    case "notes":
      return row.lead?.notes ?? null;
    case "last_contacted":
      return row.lead?.lastContactedAt ?? null;
    case "added_at":
      return row.lead?.createdAt ?? null;
  }
}

export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** True when the source policy withheld this field and no live value was loaded for this view. */
export function isRestricted(row: BusinessRow, key: FieldKey): boolean {
  return row.restrictedFields.includes(key) && isEmptyValue(fieldValue(row, key));
}

/** True when the value was loaded live from the provider for this view (not stored). */
export const isLive = (row: BusinessRow, key: FieldKey): boolean => row.liveFields.includes(key);

export function policyFor(policies: readonly SourcePolicyInfo[] | undefined, source: SourceId): SourcePolicyInfo | undefined {
  return policies?.find((p) => p.source === source);
}

export function sourceLabel(source: SourceId, policies?: readonly SourcePolicyInfo[]): string {
  const p = policyFor(policies, source);
  if (p && !p.isSample) return p.label;
  return SOURCE_LABELS[source];
}

export function attributionFor(source: SourceId, policies?: readonly SourcePolicyInfo[]): string | null {
  const p = policyFor(policies, source);
  if (p) return p.attribution;
  return SOURCE_ATTRIBUTION[source];
}

/** Tooltip text for a value that is not stored because of the source policy. */
export function restrictedMessage(source: SourceId, policies?: readonly SourcePolicyInfo[]): string {
  return `${sourceLabel(source, policies)} terms don't allow storing this field; it's loaded live when available.`;
}

export function liveMessage(source: SourceId, policies?: readonly SourcePolicyInfo[]): string {
  return `Loaded live from ${sourceLabel(source, policies)} for this view — not stored.`;
}

/**
 * Returns the URL only if it is an absolute http(s) URL — provider and website data is untrusted,
 * so anything else (javascript:, data:, relative paths) is never rendered as a link.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    // Provider websites sometimes come without a scheme ("hotel.example").
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return safeHttpUrl(`https://${s}`);
    return null;
  }
}

/** Display host for a website: lowercase, without "www.". */
export function displayHost(url: string | null | undefined, fallbackHost?: string | null): string | null {
  if (fallbackHost) return fallbackHost.replace(/^www\./i, "").toLowerCase();
  const safe = safeHttpUrl(url);
  if (!safe) return url?.trim() || null;
  return new URL(safe).hostname.replace(/^www\./i, "").toLowerCase();
}

/** Short readable form of a page URL ("hotel.example/contact"). */
export function shortUrl(url: string): string {
  const safe = safeHttpUrl(url);
  if (!safe) return url;
  const u = new URL(safe);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.hostname.replace(/^www\./i, "")}${path}`;
}

/** Years since the latest copyright year on the site (null if unknown). */
export function copyrightAge(year: number | null | undefined, now: Date = new Date()): number | null {
  if (!year || !Number.isFinite(year)) return null;
  return now.getFullYear() - year;
}

export const OUTDATED_AFTER_YEARS = 3;

export function isLikelyOutdated(year: number | null | undefined, now: Date = new Date()): boolean {
  const age = copyrightAge(year, now);
  return age != null && age >= OUTDATED_AFTER_YEARS;
}

/** Digits of an E.164 number for wa.me links; null unless the phone parsed as E.164. */
export function whatsappDigits(phoneE164: string | null | undefined): string | null {
  if (!phoneE164 || !/^\+\d{6,15}$/.test(phoneE164)) return null;
  return phoneE164.slice(1);
}

export function telHref(row: Pick<BusinessRow, "phone" | "phoneE164">): string | null {
  const raw = row.phoneE164 ?? row.phone;
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned.length >= 4 ? `tel:${cleaned}` : null;
}

/** The FoundEmail entry for the row's primary email (to show where it was found). */
export function primaryEmailSource(row: Pick<BusinessRow, "email" | "emails">): FoundEmail | undefined {
  if (!row.email) return undefined;
  const target = row.email.toLowerCase();
  return row.emails.find((e) => e.email.toLowerCase() === target);
}

/** Basic sanity check before rendering a mailto: link (the address itself is never altered). */
export const isPlausibleEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s);
