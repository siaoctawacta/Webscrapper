/**
 * Export column definitions and value formatting (pure — no secrets, no DB).
 *
 * A cell value is one of: text, number, Date or null (empty). Serializers decide how each type is
 * written (CSV: ISO 8601 dates; XLSX: real date cells) and sanitise every text cell.
 */
import type { BusinessRow } from "@/lib/api-types";
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  type LeadStatus,
  type QualityStatus,
  type Socials,
  type SourceId,
  type VerificationStatus,
  type WebsiteStatus,
} from "@/lib/domain";
import { FIELDS, type FieldKey } from "@/lib/fields";
import { rowValue } from "../rows";

export type ExportCellValue = string | number | Date | null;

export type ExportColumn = {
  key: FieldKey;
  header: string;
  /** How the value is typed in the file. */
  type: "text" | "number" | "date";
  /** Keep as text even if it looks numeric (phones, postal codes, provider IDs): XLSX numFmt "@". */
  forceText: boolean;
  /** Write as a hyperlink in XLSX when the value is a valid http(s) URL / email address. */
  link: "url" | "email" | null;
  /** XLSX number format for numbers and dates. */
  numFmt?: string;
};

export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  none: "No website",
  present: "Has website",
  unreachable: "Website unreachable",
  unknown: "Not checked",
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unknown: "Unknown",
  source_provided: "Source-provided (not verified)",
  verified: "Verified",
  invalid: "Invalid",
  needs_review: "Needs review",
};

export const QUALITY_STATUS_LABELS: Record<QualityStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  needs_review: "Needs review",
  duplicate_candidate: "Probable duplicate",
};

export const SOURCE_LABELS: Record<SourceId, string> = {
  google_places: "Google Maps",
  sample: "Sample data",
};

const BUSINESS_STATUS_LABELS: Record<string, string> = {
  OPERATIONAL: "Operational",
  CLOSED_TEMPORARILY: "Temporarily closed",
  CLOSED_PERMANENTLY: "Permanently closed",
};

/** Social networks in the order they are written. */
export const SOCIAL_ORDER = ["facebook", "instagram", "linkedin", "x", "tiktok", "youtube", "whatsapp"] as const;

/** Lead annotations appended to a collection export when "include lead status, tags and notes" is on. */
export const ANNOTATION_COLUMNS: readonly FieldKey[] = ["lead_status", "tags", "notes", "last_contacted"];

const TEXT_FORMAT_KEYS: ReadonlySet<FieldKey> = new Set<FieldKey>(["phone", "postal_code", "source_record_id"]);

const NUM_FORMATS: Partial<Record<FieldKey, string>> = {
  rating: "0.0",
  review_count: "0",
  latitude: "0.000000",
  longitude: "0.000000",
};

export const DATE_NUM_FORMAT = "yyyy-mm-dd hh:mm";

export function exportColumn(key: FieldKey): ExportColumn {
  const def = FIELDS[key];
  const type: ExportColumn["type"] = def.kind === "number" ? "number" : def.kind === "date" ? "date" : "text";
  return {
    key,
    header: def.label,
    type,
    forceText: TEXT_FORMAT_KEYS.has(key),
    link: key === "email" ? "email" : def.kind === "url" ? "url" : null,
    numFmt: type === "date" ? DATE_NUM_FORMAT : NUM_FORMATS[key],
  };
}

const humanize = (raw: string) => {
  const s = raw.replace(/_/g, " ").trim().toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
};

const label = <K extends string>(labels: Record<K, string>, v: unknown): string | null =>
  typeof v === "string" && v ? (labels[v as K] ?? humanize(v)) : null;

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return v == null ? null : String(v);
  return v.trim() === "" ? null : v;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const date = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function formatSocials(socials: Socials | null | undefined): string | null {
  if (!socials) return null;
  const parts = SOCIAL_ORDER.filter((k) => typeof socials[k] === "string" && socials[k]!.trim()).map((k) => `${k}: ${socials[k]!.trim()}`);
  return parts.length ? parts.join("; ") : null;
}

export function formatTags(tags: readonly string[] | null | undefined): string | null {
  const list = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  return list.length ? list.join(", ") : null;
}

export const leadStatusLabel = (s: unknown): string | null =>
  typeof s === "string" && (LEAD_STATUSES as readonly string[]).includes(s) ? LEAD_STATUS_LABELS[s as LeadStatus] : null;

/** The human-readable value of one field for one row (before source policy and sanitising). */
export function formatCell(row: BusinessRow, key: FieldKey): ExportCellValue {
  const v = rowValue(row, key);
  switch (key) {
    case "rating":
    case "review_count":
    case "latitude":
    case "longitude":
      return num(v);
    case "retrieved_at":
    case "last_verified":
    case "last_contacted":
    case "added_at":
      return date(v);
    case "socials":
      return formatSocials(v as Socials | null);
    case "tags":
      return formatTags(v as string[] | null);
    case "website_status":
      return label(WEBSITE_STATUS_LABELS, v);
    case "email_status":
    case "phone_status":
      return label(VERIFICATION_STATUS_LABELS, v);
    case "quality_status":
      return label(QUALITY_STATUS_LABELS, v);
    case "source":
      return label(SOURCE_LABELS, v);
    case "business_status":
      return label(BUSINESS_STATUS_LABELS, v);
    case "lead_status":
      return leadStatusLabel(v);
    default:
      return text(v);
  }
}

/** Columns actually written: the user's choice (deduplicated, in order) plus lead annotations when asked. */
export function resolveColumns(columns: readonly FieldKey[], opts: { includeAnnotations?: boolean } = {}): FieldKey[] {
  const out = [...new Set(columns)];
  if (opts.includeAnnotations) for (const k of ANNOTATION_COLUMNS) if (!out.includes(k)) out.push(k);
  return out;
}

/** Text shown for a cell value when measuring column widths and writing CSV. */
export function cellDisplayText(v: ExportCellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return typeof v === "number" ? String(v) : v;
}

const URL_MAX = 2000;
/** Hyperlink target for a cell, only for well-formed http(s) URLs and plain email addresses. */
export function hyperlinkFor(kind: ExportColumn["link"], value: ExportCellValue): string | null {
  if (!kind || typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > URL_MAX || /\s/.test(v)) return null;
  if (kind === "email") {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v) ? `mailto:${v}` : null;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
