/**
 * Pure Google Maps link parsing (no network, no secrets, no DB) — safe to unit test and to import
 * anywhere. Network resolution of short links lives in ./index.ts.
 *
 * We only read the link text itself (query, map position, zoom). We never load Google Maps pages.
 */
import type { ParsedMapsLinkDto } from "@/lib/api-types";
import type { LatLng, Rect, SearchLocation } from "@/lib/domain";

/** Result of reading a Google Maps URL (no network). */
export type ParsedMapsUrl =
  | { kind: "search"; query: string; center: LatLng | null; zoom: number | null; viewport: Rect | null }
  | { kind: "place"; name: string; center: LatLng | null; zoom: number | null; viewport: Rect | null }
  | { kind: "map_view"; center: LatLng; zoom: number | null; viewport: Rect | null }
  /** maps.app.goo.gl / goo.gl/maps links — must be resolved (see resolveMapsLink) first. */
  | { kind: "short"; url: string };

export type FullParsedMapsUrl = Exclude<ParsedMapsUrl, { kind: "short" }>;
export type ResolvedMapsLink = FullParsedMapsUrl & { resolvedUrl: string };

export class MapsLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapsLinkError";
  }
}

/** User-facing messages (plain language; shown as-is in the UI). */
export const MAPS_LINK_MESSAGES = {
  empty: "Paste a Google Maps link to get started.",
  tooLong: "That link is too long to be a Google Maps link. Copy it again from the address bar.",
  notGoogle: "That doesn't look like a Google Maps link.",
  googleSearch:
    "That's a Google Search link, not a Google Maps link. Open Google Maps, search there (e.g. 'hotel'), then copy the link from the address bar.",
  noSearch:
    "This link shows a map but no search. Search for something on Google Maps (e.g. 'hotel'), then copy the link from the address bar.",
  directions:
    "This is a directions link. Search for a type of business on Google Maps (e.g. 'hotel') or open a single business, then copy that link.",
  myMaps:
    "Embedded maps and My Maps links aren't supported. Open your search in Google Maps, then copy the link from the address bar.",
  placeById:
    "We can't read the place from this kind of link. Open it in Google Maps, then copy the full link from the address bar.",
  unsupported:
    "We couldn't find a search or a place in this Google Maps link. Search on Google Maps, then copy the link from the address bar.",
  consent:
    "Google showed a cookie-consent page instead of the map. Open the link in your browser, accept or reject cookies, then copy the link from the address bar.",
  shortNotGoogle: "This short link doesn't lead to Google Maps.",
  shortDead:
    "This short link didn't lead to a Google Maps page. It may have expired — open it in your browser and copy the full link from the address bar.",
  shortUnreachable:
    "We couldn't open this short link right now. Try again, or open it in your browser and paste the full link from the address bar.",
  tooManyRedirects:
    "This short link redirects too many times. Open it in your browser and paste the full link from the address bar.",
} as const;

/** Message for callers that receive a map-view link but need a search term (e.g. the search form). */
export const MAP_VIEW_NEEDS_QUERY_MESSAGE = MAPS_LINK_MESSAGES.noSearch;

export const MAX_MAPS_LINK_LENGTH = 4096;
/** Browser viewport assumed when converting a zoom level into a map rectangle. */
export const DEFAULT_VIEWPORT_PX = { width: 1280, height: 800 } as const;
/** Zoom used for the search area when a link has a position but no zoom (≈12 × 7.6 km near the equator). */
export const DEFAULT_AREA_ZOOM = 14;
/** Zoom used around a place pin when the link has no zoom. */
export const DEFAULT_PLACE_ZOOM = 17;

const MIN_ZOOM = 1;
const MAX_ZOOM = 21;
const METERS_PER_PIXEL_Z0 = 156543.03392;
const MAX_MERCATOR_LAT = 85.05112878;
const EARTH_RADIUS_M = 6_371_008.8;

/* ───────────────────────────── hosts ───────────────────────────── */

/** google.com, google.fr, google.tg, google.com.gh, google.co.uk, maps.google.*, www.google.* … */
const GOOGLE_HOST_RE = /^(?:[a-z0-9-]+\.)*google\.(?:com?\.[a-z]{2}|[a-z]{2,3})$/;

export function isGoogleHost(hostname: string): boolean {
  return GOOGLE_HOST_RE.test(normalizeHost(hostname));
}

/** maps.app.goo.gl/<id> and goo.gl/maps/<id> short links. */
export function isShortLinkUrl(url: URL): boolean {
  const host = normalizeHost(url.hostname);
  const path = url.pathname.replace(/\/+$/, "");
  if (host === "maps.app.goo.gl") return path.length > 1;
  if (host === "goo.gl" || host === "www.goo.gl") return /^\/maps\/[^/]+/.test(path);
  return false;
}

/** Whether a URL may be followed while resolving a short link (Google or Google short-link host). */
export function isAllowedRedirectTarget(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  return isShortLinkUrl(url) || isGoogleHost(url.hostname);
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/* ───────────────────────────── input → URL ───────────────────────────── */

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]|$)/i;

/** Turn user input (possibly shared text containing a link) into a validated http(s) URL. */
export function toMapsUrl(input: string): URL {
  if (typeof input !== "string") throw new MapsLinkError(MAPS_LINK_MESSAGES.empty);
  let s = input.trim();
  if (!s) throw new MapsLinkError(MAPS_LINK_MESSAGES.empty);
  if (s.length > MAX_MAPS_LINK_LENGTH) throw new MapsLinkError(MAPS_LINK_MESSAGES.tooLong);

  // Shared text such as "Hôtel Sarakawa\nhttps://maps.app.goo.gl/abc": use the first web link in it.
  if (/\s/.test(s)) {
    const m = s.match(/https?:\/\/[^\s<>"'`]+/i);
    if (!m) throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
    s = m[0];
  }
  s = s.replace(/^<(.*)>$/s, "$1").replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");

  if (s.startsWith("//")) s = `https:${s}`;
  else if (!SCHEME_RE.test(s)) {
    // "www.google.com/maps/…" or "maps.app.goo.gl/…" pasted without https://. Anything else with a
    // scheme-like prefix (javascript:, data:, mailto:) ends up here and is rejected.
    if (!BARE_HOST_RE.test(s)) throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
    s = `https://${s}`;
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
  if (url.username || url.password || url.port) throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
  if (url.protocol === "http:") url.protocol = "https:";
  return url;
}

/**
 * Google wrapper pages that carry the real link in a parameter: consent.google.com/m?continue=<url>,
 * www.google.com/sorry/index?continue=<url> and www.google.com/url?q=<url> (any Google domain).
 * Returns the page Google meant to show,
 * the URL itself when it is not a wrapper, or null if there is no usable target.
 */
export function unwrapGoogleInterstitial(url: URL): URL | null {
  let current = url;
  for (let i = 0; i < 3; i++) {
    const host = normalizeHost(current.hostname);
    if (!isGoogleHost(host)) return current;
    const isConsent = host.startsWith("consent.");
    const isSorry = current.pathname.startsWith("/sorry/");
    const isRedirector = current.pathname === "/url";
    if (!isConsent && !isSorry && !isRedirector) return current;
    const next = isRedirector
      ? (current.searchParams.get("q") ?? current.searchParams.get("url"))
      : current.searchParams.get("continue");
    if (!next) return null;
    let target: URL;
    try {
      target = new URL(next);
    } catch {
      return null;
    }
    if (!isAllowedRedirectTarget(target)) return null;
    if (target.protocol === "http:") target.protocol = "https:";
    current = target;
  }
  return null;
}

/* ───────────────────────────── parsing ───────────────────────────── */

export type DetailedParse = { parsed: ParsedMapsUrl; url: string };

/** Parse a full Google Maps URL. Throws MapsLinkError with a user-friendly message. */
export function parseMapsUrl(input: string): ParsedMapsUrl {
  return parseMapsUrlDetailed(input).parsed;
}

/** Like parseMapsUrl, but also returns the normalized URL that was actually read. */
export function parseMapsUrlDetailed(input: string): DetailedParse {
  const url = toMapsUrl(input);
  return parseUrlObject(url);
}

function parseUrlObject(original: URL): DetailedParse {
  if (isShortLinkUrl(original)) return { parsed: { kind: "short", url: original.href }, url: original.href };

  const host = normalizeHost(original.hostname);
  if (host === "goo.gl" || host === "www.goo.gl" || host === "maps.app.goo.gl") {
    throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
  }
  if (!isGoogleHost(host)) throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);

  const url = unwrapGoogleInterstitial(original);
  if (!url) throw new MapsLinkError(MAPS_LINK_MESSAGES.consent);
  if (url !== original) {
    if (isShortLinkUrl(url)) return { parsed: { kind: "short", url: url.href }, url: url.href };
    if (!isGoogleHost(url.hostname)) throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);
  }
  return { parsed: parseGoogleMapsUrl(url), url: url.href };
}

type AtPosition = { center: LatLng; zoom: number | null };

function parseGoogleMapsUrl(url: URL): FullParsedMapsUrl {
  const host = normalizeHost(url.hostname);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const params = url.searchParams;

  let rest: string[];
  if (segments[0]?.toLowerCase() === "maps") rest = segments.slice(1);
  else if (host.startsWith("maps.")) rest = segments;
  else if (segments.length === 0 || segments[0] === "search" || segments[0] === "webhp") {
    throw new MapsLinkError(params.has("q") ? MAPS_LINK_MESSAGES.googleSearch : MAPS_LINK_MESSAGES.notGoogle);
  } else throw new MapsLinkError(MAPS_LINK_MESSAGES.notGoogle);

  const mode = rest[0]?.toLowerCase() ?? "";
  const at = findAtPosition(rest);
  const paramPosition = positionFromParams(params);
  const position: AtPosition | null = at ?? paramPosition;

  switch (mode) {
    case "dir":
      throw new MapsLinkError(MAPS_LINK_MESSAGES.directions);
    case "d":
    case "embed":
    case "ms":
      throw new MapsLinkError(MAPS_LINK_MESSAGES.myMaps);
    case "search":
      return parseSearchPath(rest, params, position);
    case "place":
      return parsePlacePath(url, rest, params, position);
    default: {
      // "/maps", "/maps/@lat,lng,zoom" and "/maps?q=…" are map links; other paths we don't know.
      const isMapPath = mode === "" || mode.startsWith("@");
      return parseFromParams(params, position, isMapPath ? MAPS_LINK_MESSAGES.noSearch : MAPS_LINK_MESSAGES.unsupported);
    }
  }
}

/** /maps/search/<query>/@lat,lng,zoom/… and /maps/search/?api=1&query=… */
function parseSearchPath(rest: string[], params: URLSearchParams, position: AtPosition | null): FullParsedMapsUrl {
  const seg = rest[1];
  const fromPath = seg && !isMetaSegment(seg) ? decodeSegment(seg) : "";
  const text = fromPath || cleanText(params.get("query") ?? params.get("q") ?? "");
  if (!text) {
    if (position) return mapView(position);
    throw new MapsLinkError(MAPS_LINK_MESSAGES.noSearch);
  }
  const coords = parseLatLngText(text);
  if (coords) return mapView(position ?? { center: coords, zoom: null });
  if (params.get("query_place_id")) return place(text, position?.center ?? null, position);
  return search(text, position);
}

/** /maps/place/<name>/@lat,lng,zoom/data=…!3d<lat>!4d<lng>… */
function parsePlacePath(url: URL, rest: string[], params: URLSearchParams, position: AtPosition | null): FullParsedMapsUrl {
  const seg = rest[1];
  const name = seg && !isMetaSegment(seg) ? decodeSegment(seg) : "";
  const pin = findDataPin(url.pathname);
  const pinOrPosition = pin ?? position?.center ?? null;

  // A dropped pin ("6°07'54.0"N 1°13'22.1"E") or plain coordinates is a location, not a business.
  const coordsName = name ? (parseDmsText(name) ?? parseLatLngText(name)) : null;
  if (!name || coordsName) {
    const center = pin ?? coordsName ?? position?.center ?? null;
    if (center) return mapView({ center, zoom: position?.zoom ?? null });
    return parseFromParams(params, position, MAPS_LINK_MESSAGES.unsupported);
  }
  return place(name, pinOrPosition, position);
}

/** /maps?q=…, maps.google.com/?q=…&ftid=…, /maps/@lat,lng,zoom, ?api=1&map_action=map&center=… */
function parseFromParams(
  params: URLSearchParams,
  position: AtPosition | null,
  fallbackMessage: string = MAPS_LINK_MESSAGES.noSearch,
): FullParsedMapsUrl {
  const text = cleanText(params.get("q") ?? params.get("query") ?? "");
  if (text) {
    if (/^place_id:/i.test(text)) throw new MapsLinkError(MAPS_LINK_MESSAGES.placeById);
    const coords = parseLatLngText(text) ?? parseDmsText(text);
    if (coords) return mapView({ center: coords, zoom: position?.zoom ?? null });
    // A feature id / place id next to the text means the link points at one business.
    if (params.get("ftid") || params.get("query_place_id")) return place(text, null, position);
    return search(text, position);
  }
  if (params.get("cid") || params.get("ftid") || params.get("query_place_id")) {
    throw new MapsLinkError(MAPS_LINK_MESSAGES.placeById);
  }
  if (position) return mapView(position);
  throw new MapsLinkError(fallbackMessage);
}

function search(query: string, position: AtPosition | null): FullParsedMapsUrl {
  const center = position?.center ?? null;
  const zoom = position?.zoom ?? null;
  return { kind: "search", query, center, zoom, viewport: center && zoom !== null ? viewportFromZoom(center, zoom) : null };
}

function place(name: string, pin: LatLng | null, position: AtPosition | null): FullParsedMapsUrl {
  const zoom = position?.zoom ?? null;
  // The visible map area is centred on the camera (@…); fall back to the pin.
  const camera = position?.center ?? pin;
  return {
    kind: "place",
    name,
    center: pin ?? camera ?? null,
    zoom,
    viewport: camera && zoom !== null ? viewportFromZoom(camera, zoom) : null,
  };
}

function mapView(position: AtPosition): FullParsedMapsUrl {
  const { center, zoom } = position;
  return { kind: "map_view", center, zoom, viewport: zoom !== null ? viewportFromZoom(center, zoom) : null };
}

/* ───────────────────────────── segment helpers ───────────────────────────── */

function isMetaSegment(seg: string): boolean {
  return seg.startsWith("@") || /^(?:data|am|entry)=/i.test(seg);
}

/** Decode a path segment: '+' is a space, percent-encoding is UTF-8 ("h%C3%B4tel" → "hôtel"). */
export function decodeSegment(raw: string): string {
  const spaced = raw.replace(/\+/g, " ");
  let decoded: string;
  try {
    decoded = decodeURIComponent(spaced);
  } catch {
    // Malformed escapes: decode what we can, keep the rest as typed.
    decoded = spaced.replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
  return cleanText(decoded);
}

function cleanText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;
const AT_RE = new RegExp(String.raw`^@(${NUM}),(${NUM})(?:,(\d+(?:\.\d+)?)([a-z]))?`, "i");

function findAtPosition(rest: string[]): AtPosition | null {
  for (const seg of rest) {
    if (!seg.startsWith("@")) continue;
    const m = AT_RE.exec(decodeSafe(seg));
    if (!m) continue;
    const center = toLatLng(m[1], m[2]);
    if (!center) continue;
    const value = m[3] !== undefined ? Number(m[3]) : null;
    const unit = m[4]?.toLowerCase();
    let zoom: number | null = null;
    if (value !== null && Number.isFinite(value)) {
      if (unit === "z") zoom = clampZoom(value);
      else if (unit === "m") zoom = metersToZoom(value, center.lat);
      // "a": 3D view altitude in meters; tiny values ("3a") are Street View, which has no zoom.
      else if (unit === "a" && value > 10) zoom = metersToZoom(value, center.lat);
    }
    return { center, zoom };
  }
  return null;
}

function positionFromParams(params: URLSearchParams): AtPosition | null {
  const raw = params.get("ll") ?? params.get("center") ?? params.get("viewpoint") ?? params.get("sll");
  const center = raw ? parseLatLngText(raw) : null;
  if (!center) return null;
  const z = params.get("z") ?? params.get("zoom");
  const zoom = z !== null && z.trim() !== "" && Number.isFinite(Number(z)) ? clampZoom(Number(z)) : null;
  return { center, zoom };
}

/** The place pin inside `data=…`: prefer `!8m2!3d<lat>!4d<lng>`, else the last `!3d…!4d…` pair. */
function findDataPin(pathname: string): LatLng | null {
  const path = decodeSafe(pathname);
  const preferred = new RegExp(String.raw`!8m2!3d(${NUM})!4d(${NUM})`).exec(path);
  if (preferred) {
    const p = toLatLng(preferred[1], preferred[2]);
    if (p) return p;
  }
  let last: LatLng | null = null;
  for (const m of path.matchAll(new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`, "g"))) {
    const p = toLatLng(m[1], m[2]);
    if (p) last = p;
  }
  return last;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "6.1319,1.2228", "6.1319, 1.2228" or "6.1319 1.2228" → LatLng. */
export function parseLatLngText(text: string): LatLng | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  return m ? toLatLng(m[1], m[2]) : null;
}

/** 6°07'54.0"N 1°13'22.1"E → LatLng. */
export function parseDmsText(text: string): LatLng | null {
  const part = String.raw`(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]\s*`;
  const m = new RegExp(String.raw`^\s*${part}([NS])\s*,?\s*${part}([EW])\s*$`, "i").exec(text);
  if (!m) return null;
  const dms = (d?: string, mi?: string, s?: string) => Number(d) + Number(mi) / 60 + Number(s) / 3600;
  let lat = dms(m[1], m[2], m[3]);
  let lng = dms(m[5], m[6], m[7]);
  if (m[4]?.toUpperCase() === "S") lat = -lat;
  if (m[8]?.toUpperCase() === "W") lng = -lng;
  return toLatLng(String(lat), String(lng));
}

function toLatLng(latRaw: string | undefined, lngRaw: string | undefined): LatLng | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Satellite links say "@lat,lng,3214m": roughly the height of the visible map in meters.
 * Convert to the zoom that shows that height in the default 800 px tall viewport.
 */
export function metersToZoom(meters: number, lat: number, heightPx: number = DEFAULT_VIEWPORT_PX.height): number {
  if (!(meters > 0)) return MAX_ZOOM;
  const z = Math.log2((METERS_PER_PIXEL_Z0 * Math.cos(toRad(lat)) * heightPx) / meters);
  return Math.round(clampZoom(z) * 100) / 100;
}

/* ───────────────────────────── geometry ───────────────────────────── */

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Approximate the visible map rectangle for a center + zoom (default 1280×800 px viewport), using
 * Web Mercator (ground resolution = 156543.03392·cos(lat)/2^zoom meters per pixel).
 */
export function viewportFromZoom(center: LatLng, zoom: number, px?: { width: number; height: number }): Rect {
  const width = px && px.width > 0 ? px.width : DEFAULT_VIEWPORT_PX.width;
  const height = px && px.height > 0 ? px.height : DEFAULT_VIEWPORT_PX.height;
  const z = Number.isFinite(zoom) ? Math.min(22, Math.max(0, zoom)) : DEFAULT_AREA_ZOOM;
  const world = 256 * 2 ** z;

  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, center.lat));
  const x = ((center.lng + 180) / 360) * world;
  const sin = Math.sin(toRad(lat));
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;

  const toLng = (px: number) => Math.max(-180, Math.min(180, (px / world) * 360 - 180));
  const toLat = (py: number) => {
    const clamped = Math.max(0, Math.min(world, py));
    return toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * clamped) / world))));
  };

  return {
    low: { lat: toLat(y + height / 2), lng: toLng(x - width / 2) },
    high: { lat: toLat(y - height / 2), lng: toLng(x + width / 2) },
  };
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Width × height of a rectangle in meters, measured through its middle. */
export function rectSizeMeters(rect: Rect): { width: number; height: number } {
  const midLat = (rect.low.lat + rect.high.lat) / 2;
  const lngSpan = rect.high.lng >= rect.low.lng ? rect.high.lng - rect.low.lng : rect.high.lng + 360 - rect.low.lng;
  const width = toRad(lngSpan) * EARTH_RADIUS_M * Math.cos(toRad(midLat));
  const height = toRad(Math.abs(rect.high.lat - rect.low.lat)) * EARTH_RADIUS_M;
  return { width, height };
}

/** "≈49 × 30 km", "≈3.1 × 1.9 km", "≈780 × 490 m". */
export function formatAreaSize(rect: Rect): string {
  const { width, height } = rectSizeMeters(rect);
  if (Math.max(width, height) < 1000) {
    const m = (v: number) => String(Math.max(10, Math.round(v / 10) * 10));
    return `≈${m(width)} × ${m(height)} m`;
  }
  const km = (v: number) => {
    const k = v / 1000;
    return k < 10 ? String(Math.round(k * 10) / 10) : String(Math.round(k));
  };
  return `≈${km(width)} × ${km(height)} km`;
}

const coord = (v: number) => String(Number(v.toFixed(4)));

/* ───────────────────────────── outputs ───────────────────────────── */

/** Human label + center + area to search, for storing on a search job and showing in the UI. */
export function toSearchLocation(parsed: FullParsedMapsUrl): SearchLocation {
  if (parsed.kind === "place") {
    const center = parsed.center ?? undefined;
    const viewport = parsed.viewport ?? (parsed.center ? viewportFromZoom(parsed.center, DEFAULT_PLACE_ZOOM) : undefined);
    return { label: parsed.name, ...(center ? { center } : {}), ...(viewport ? { viewport } : {}) };
  }
  const center = parsed.center;
  if (!center) return { label: "No map area in the link" };
  const viewport = parsed.viewport ?? viewportFromZoom(center, DEFAULT_AREA_ZOOM);
  return {
    label: `Map area near ${coord(center.lat)}, ${coord(center.lng)} · ${formatAreaSize(viewport)}`,
    center,
    viewport,
  };
}

/** API shape for POST /api/v1/maps-links/parse. */
export function toParsedMapsLinkDto(link: ResolvedMapsLink): ParsedMapsLinkDto {
  const location = toSearchLocation(link);
  switch (link.kind) {
    case "search":
      return { kind: "search", query: link.query, location, resolvedUrl: link.resolvedUrl };
    case "place":
      return { kind: "place", name: link.name, location, resolvedUrl: link.resolvedUrl };
    case "map_view":
      return { kind: "map_view", location, resolvedUrl: link.resolvedUrl };
  }
}
