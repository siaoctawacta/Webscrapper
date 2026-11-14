// CONTRACT STUB — implemented by the "google" module agent. Keep these export signatures.
import type { LatLng, Rect } from "@/lib/domain";

/** Result of reading a Google Maps URL (no network). */
export type ParsedMapsUrl =
  | { kind: "search"; query: string; center: LatLng | null; zoom: number | null; viewport: Rect | null }
  | { kind: "place"; name: string; center: LatLng | null; zoom: number | null; viewport: Rect | null }
  | { kind: "map_view"; center: LatLng; zoom: number | null; viewport: Rect | null }
  /** maps.app.goo.gl / goo.gl/maps links — must be resolved (see resolveMapsLink) first. */
  | { kind: "short"; url: string };

export class MapsLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapsLinkError";
  }
}

/** Parse a full Google Maps URL. Throws MapsLinkError with a user-friendly message. */
export function parseMapsUrl(_input: string): ParsedMapsUrl {
  throw new MapsLinkError("Not implemented yet");
}

/**
 * Parse any Google Maps link, following short-link redirects (only to Google hosts, max 5 hops,
 * no page content is read). Never returns kind "short".
 */
export async function resolveMapsLink(
  _input: string,
  _opts?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<Exclude<ParsedMapsUrl, { kind: "short" }> & { resolvedUrl: string }> {
  throw new MapsLinkError("Not implemented yet");
}

/** Approximate the visible map rectangle for a center + zoom (default 1280×800 px viewport). */
export function viewportFromZoom(_center: LatLng, _zoom: number, _px?: { width: number; height: number }): Rect {
  throw new Error("Not implemented yet");
}
