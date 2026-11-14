import "server-only";
import type { SearchKind, SearchLocation } from "@/lib/domain";
import { HttpError } from "../errors";
import { MAP_VIEW_NEEDS_QUERY_MESSAGE, MapsLinkError, resolveMapsLink, toSearchLocation } from "../maps-link";
import { ProviderError, type BusinessProvider, type GeocodeResult, type ProviderContext } from "../providers/types";
import type { CreateSearchInput } from "./schemas";

/** What a search job will look for, after reading the link or geocoding the typed location. */
export type ResolvedSearch = {
  kind: SearchKind;
  /** Search term, or the business name for a place link. */
  query: string;
  location: SearchLocation;
  /** The Google Maps link exactly as the user pasted it (trimmed). */
  sourceUrl: string | null;
  /** Place links look up exactly one business. */
  singlePlace: boolean;
};

export type TargetDeps = {
  resolveLink?: typeof resolveMapsLink;
  /** Receives every provider request made while resolving (geocoding), for usage accounting. */
  onUsage?: ProviderContext["onUsage"];
  signal?: AbortSignal;
  /**
   * When false, typed locations are not geocoded (used by the live estimate for billable providers,
   * so typing in the form never costs Google requests). Defaults to true.
   */
  geocode?: boolean;
};

export const LOCATION_NOT_FOUND_MESSAGE = "We couldn't find that location. Try a city and country, for example “Lomé, Togo”.";
export const LINK_AREA_NOT_FOUND_MESSAGE =
  "We couldn't tell which area this link covers. Move the map to the area you want in Google Maps and copy the link again, or type a location as well.";

function locationFromGeocode(g: GeocodeResult): SearchLocation {
  return {
    label: g.label,
    ...(g.city ? { city: g.city } : {}),
    ...(g.country ? { country: g.country } : {}),
    center: g.center,
    viewport: g.viewport,
  };
}

async function geocodeOrThrow(provider: BusinessProvider, text: string, message: string, deps: TargetDeps): Promise<SearchLocation> {
  let g: GeocodeResult | null;
  try {
    g = await provider.geocode(text, { signal: deps.signal, onUsage: deps.onUsage });
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError("provider_error", e.message);
    throw e;
  }
  if (!g) throw new HttpError("validation_failed", message);
  return locationFromGeocode(g);
}

/**
 * Turn the request into a concrete search: a Maps link is read (short links followed), a typed
 * location is geocoded with the provider. Throws HttpError("validation_failed") with a plain message
 * when the link or location cannot be used.
 */
export async function resolveSearchTarget(input: CreateSearchInput, provider: BusinessProvider, deps: TargetDeps = {}): Promise<ResolvedSearch> {
  const geocode = deps.geocode !== false;

  if (input.mapsUrl) {
    const resolve = deps.resolveLink ?? resolveMapsLink;
    let link: Awaited<ReturnType<typeof resolveMapsLink>>;
    try {
      link = await resolve(input.mapsUrl, { signal: deps.signal });
    } catch (e) {
      if (e instanceof MapsLinkError) throw new HttpError("validation_failed", e.message);
      throw e;
    }
    const sourceUrl = input.mapsUrl;

    switch (link.kind) {
      case "place":
        return { kind: "maps_place_link", query: link.name, location: toSearchLocation(link), sourceUrl, singlePlace: true };

      case "map_view": {
        if (!input.query) throw new HttpError("validation_failed", MAP_VIEW_NEEDS_QUERY_MESSAGE);
        return { kind: "maps_search_link", query: input.query, location: toSearchLocation(link), sourceUrl, singlePlace: false };
      }

      case "search": {
        // A term typed by the user wins over the one in the link.
        const query = input.query ?? link.query;
        let location = toSearchLocation(link);
        if (!location.viewport) {
          // e.g. /maps/search/hotels+in+Lomé with no "@lat,lng,zoom": find the area from the text.
          const text = input.location ?? link.query;
          location = geocode ? await geocodeOrThrow(provider, text, LINK_AREA_NOT_FOUND_MESSAGE, deps) : { label: text };
        }
        return { kind: "maps_search_link", query, location, sourceUrl, singlePlace: false };
      }
    }
  }

  // Keyword + location (the schema guarantees both are present here).
  const query = input.query ?? "";
  const text = input.location ?? "";
  const location = geocode ? await geocodeOrThrow(provider, text, LOCATION_NOT_FOUND_MESSAGE, deps) : { label: text };
  return { kind: "keyword", query, location, sourceUrl: null, singlePlace: false };
}
