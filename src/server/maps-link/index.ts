import "server-only";
import {
  MAPS_LINK_MESSAGES,
  MapsLinkError,
  isAllowedRedirectTarget,
  isShortLinkUrl,
  parseMapsUrlDetailed,
  unwrapGoogleInterstitial,
  type ParsedMapsUrl,
} from "./parse";

/*
 * Google Maps link reading. Pure parsing lives in ./parse (re-exported here); this file adds the
 * short-link resolver, which is the only part that touches the network.
 */
export {
  DEFAULT_AREA_ZOOM,
  DEFAULT_PLACE_ZOOM,
  DEFAULT_VIEWPORT_PX,
  MAPS_LINK_MESSAGES,
  MAP_VIEW_NEEDS_QUERY_MESSAGE,
  MAX_MAPS_LINK_LENGTH,
  MapsLinkError,
  formatAreaSize,
  isGoogleHost,
  isShortLinkUrl,
  parseMapsUrl,
  parseMapsUrlDetailed,
  toParsedMapsLinkDto,
  toSearchLocation,
  viewportFromZoom,
  type FullParsedMapsUrl,
  type ParsedMapsUrl,
  type ResolvedMapsLink,
} from "./parse";

export const MAX_REDIRECT_HOPS = 5;
const HOP_TIMEOUT_MS = 8_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Parse any Google Maps link, following short-link redirects (only to Google hosts, max 5 hops,
 * no page content is read). Never returns kind "short".
 */
export async function resolveMapsLink(
  input: string,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<Exclude<ParsedMapsUrl, { kind: "short" }> & { resolvedUrl: string }> {
  const first = parseMapsUrlDetailed(input);
  if (first.parsed.kind !== "short") return { ...first.parsed, resolvedUrl: first.url };

  const fetchImpl = opts?.fetch ?? globalThis.fetch;
  let current = first.parsed.url;
  // A Google URL we could not read yet; reported if following it leads nowhere better.
  let pending: MapsLinkError | null = null;

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const res = await fetchHop(fetchImpl, current, opts?.signal);
    const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get("location") : null;
    if (!location) throw pending ?? new MapsLinkError(MAPS_LINK_MESSAGES.shortDead);

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new MapsLinkError(MAPS_LINK_MESSAGES.shortDead);
    }
    if (!isAllowedRedirectTarget(next)) throw new MapsLinkError(MAPS_LINK_MESSAGES.shortNotGoogle);
    if (next.protocol === "http:") next.protocol = "https:";

    const target = unwrapGoogleInterstitial(next);
    if (!target) throw new MapsLinkError(MAPS_LINK_MESSAGES.consent);
    if (!isAllowedRedirectTarget(target)) throw new MapsLinkError(MAPS_LINK_MESSAGES.shortNotGoogle);

    if (isShortLinkUrl(target)) {
      current = target.href;
      continue;
    }
    try {
      const detailed = parseMapsUrlDetailed(target.href);
      if (detailed.parsed.kind === "short") {
        current = detailed.parsed.url;
        continue;
      }
      return { ...detailed.parsed, resolvedUrl: detailed.url };
    } catch (e) {
      if (!(e instanceof MapsLinkError)) throw e;
      // Some Google URLs (e.g. maps.google.com/?cid=…) redirect once more to a readable one.
      pending = e;
      current = target.href;
    }
  }
  throw pending ?? new MapsLinkError(MAPS_LINK_MESSAGES.tooManyRedirects);
}

/** One redirect hop: GET with redirect "manual"; the body is discarded unread. */
async function fetchHop(fetchImpl: typeof fetch, url: string, signal: AbortSignal | undefined): Promise<Response> {
  const timeout = AbortSignal.timeout(HOP_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: combined,
      headers: { accept: "text/html,application/xhtml+xml", "accept-language": "en,fr;q=0.8" },
    });
  } catch (e) {
    if (signal?.aborted) throw signal.reason ?? e;
    throw new MapsLinkError(MAPS_LINK_MESSAGES.shortUnreachable);
  }
  try {
    await res.body?.cancel();
  } catch {
    // Ignore: we never need the body.
  }
  return res;
}
