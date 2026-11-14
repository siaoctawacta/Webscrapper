/**
 * Download file names (pure), e.g. "leads-hôtel-lomé-2026-11-14.xlsx" with the ASCII fallback
 * "leads-hotel-lome-2026-11-14.xlsx" for the Content-Disposition header.
 */
import type { ExportFormat } from "@/lib/domain";

const MAX_SLUG = 60;

/** Lower-case words joined by "-", keeping letters from any script (NFC). */
export function slugify(input: string): string {
  return input
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
}

/** ASCII-only version of a file name: accents removed, anything else replaced by "-". */
export function asciiFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]/g, "") : "";
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "export"}${ext}`;
}

/** RFC 6266 / 5987 Content-Disposition for a download. */
export function contentDisposition(fileName: string): string {
  const ascii = asciiFileName(fileName).replace(/["\\]/g, "");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** First part of a location label ("Lomé, Togo" → "Lomé"); generic map-area labels are skipped. */
export function placeName(location: { label?: string | null; city?: string | null } | null | undefined): string | null {
  if (location?.city?.trim()) return location.city.trim();
  const label = location?.label?.trim();
  if (!label || /^map area\b/i.test(label) || /\d+\.\d+/.test(label)) return null;
  return label.split(",")[0]!.trim() || null;
}

export function exportFileName(parts: (string | null | undefined)[], date: Date, format: ExportFormat): string {
  const words = slugify(parts.filter((p): p is string => Boolean(p?.trim())).join(" "));
  const day = date.toISOString().slice(0, 10);
  return `leads-${words ? `${words}-` : ""}${day}.${format}`;
}
