/**
 * Design tokens for homepage concepts: style palettes, font stacks and WCAG contrast maths.
 * Pure module (no DB, no secrets).
 */
import { HEX_COLOR_RE, PALETTE_KEYS, type ConceptPalette, type ConceptStyle, type TypographyPairing } from "./schema";

/** Minimum contrast for body text (WCAG 2.x AA, normal text). */
export const MIN_TEXT_CONTRAST = 4.5;

/** Six preset palettes; every one passes text/background and text/surface ≥ 4.5:1. */
export const STYLE_PALETTES: Record<ConceptStyle, ConceptPalette> = {
  modern: { primary: "#2563eb", secondary: "#0f172a", accent: "#0891b2", background: "#ffffff", surface: "#f1f5f9", text: "#0f172a" },
  minimal: { primary: "#18181b", secondary: "#3f3f46", accent: "#71717a", background: "#ffffff", surface: "#f4f4f5", text: "#18181b" },
  elegant: { primary: "#7a5c35", secondary: "#2b2420", accent: "#b8955a", background: "#fbf8f3", surface: "#f1ebe1", text: "#2b2420" },
  bold: { primary: "#e11d48", secondary: "#111827", accent: "#f59e0b", background: "#ffffff", surface: "#fff1f2", text: "#111827" },
  playful: { primary: "#7c3aed", secondary: "#db2777", accent: "#f59e0b", background: "#fffbf5", surface: "#f5f0ff", text: "#1f1235" },
  natural: { primary: "#2f6b3b", secondary: "#4b3b2a", accent: "#8a9a5b", background: "#f8f6f0", surface: "#ecefe4", text: "#1f2a1f" },
};

export const STYLE_TYPOGRAPHY: Record<ConceptStyle, TypographyPairing> = {
  modern: "modern-sans",
  minimal: "modern-sans",
  elegant: "elegant-serif",
  bold: "modern-sans",
  playful: "friendly-rounded",
  natural: "classic",
};

const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`;

/** System font stacks only — the concept page may not load web fonts (CSP). */
export const FONT_STACKS: Record<TypographyPairing, { heading: string; body: string }> = {
  "modern-sans": { heading: SANS, body: SANS },
  "elegant-serif": {
    heading: `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif`,
    body: SANS,
  },
  "friendly-rounded": {
    heading: `ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", ${SANS}`,
    body: `ui-rounded, "SF Pro Rounded", ${SANS}`,
  },
  classic: {
    heading: `Georgia, Cambria, "Times New Roman", Times, serif`,
    body: `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif`,
  },
};

export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX_COLOR_RE.test(v);

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio (1–21) between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black-ish or white text, whichever reads better on `bg`. */
export function readableOn(bg: string, dark = "#111111", light = "#ffffff"): string {
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

/** True when every colour is #rrggbb and text reads well on both the background and the surface. */
export function isUsablePalette(p: Partial<Record<keyof ConceptPalette, unknown>>): p is ConceptPalette {
  if (!PALETTE_KEYS.every((k) => isHexColor(p[k]))) return false;
  const q = p as ConceptPalette;
  return contrastRatio(q.text, q.background) >= MIN_TEXT_CONTRAST && contrastRatio(q.text, q.surface) >= MIN_TEXT_CONTRAST;
}

const lower = (p: ConceptPalette): ConceptPalette =>
  Object.fromEntries(PALETTE_KEYS.map((k) => [k, p[k].toLowerCase()])) as ConceptPalette;

/** The style's preset palette, with the user's primary colour when they chose one. */
export function stylePalette(style: ConceptStyle, primaryColor?: string): ConceptPalette {
  const base = STYLE_PALETTES[style] ?? STYLE_PALETTES.modern;
  return lower(isHexColor(primaryColor) ? { ...base, primary: primaryColor } : base);
}

/**
 * Validate a palette proposed by the AI. Invalid colours or low text contrast → the style palette.
 * The user's primary colour always wins over the AI's.
 */
export function resolvePalette(
  proposed: Partial<Record<keyof ConceptPalette, unknown>> | null | undefined,
  style: ConceptStyle,
  primaryColor?: string,
): { palette: ConceptPalette; fallback: "invalid" | "low_contrast" | null } {
  if (!proposed || !PALETTE_KEYS.every((k) => isHexColor(proposed[k]))) {
    return { palette: stylePalette(style, primaryColor), fallback: "invalid" };
  }
  const candidate = lower({ ...(proposed as ConceptPalette), ...(isHexColor(primaryColor) ? { primary: primaryColor } : {}) });
  if (!isUsablePalette(candidate)) return { palette: stylePalette(style, primaryColor), fallback: "low_contrast" };
  return { palette: candidate, fallback: null };
}
