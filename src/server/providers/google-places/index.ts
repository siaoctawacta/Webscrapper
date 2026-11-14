import "server-only";
import type { LatLng, Rect } from "@/lib/domain";
import { ProviderError, type BusinessProvider, type GeocodeResult, type ProviderContext, type ProviderPlace, type SearchPlan } from "../types";
import { estimateGoogleTextSearch, PAGE_SIZE } from "./estimate";
import { boxAround } from "./geo";
import { PlacesHttp, type GooglePlacesDeps } from "./http";
import {
  DETAILS_FIELD_MASK,
  FIND_PLACE_FIELD_MASK,
  GEOCODE_FIELD_MASK,
  TEXT_SEARCH_FIELD_MASK,
  addressParts,
  mapPlace,
  mapPlaces,
  readLatLng,
  readNextPageToken,
  readPlaces,
  readViewport,
  str,
} from "./mapping";
import { pickBestMatch } from "./match";
import { tiledSearch } from "./tiling";

export type { GooglePlacesDeps } from "./http";
export { PROVIDER_MESSAGES } from "./http";
export { estimateGoogleTextSearch } from "./estimate";

export type GooglePlacesOptions = {
  apiKey: string;
  textSearchPricePer1000: number;
  detailsPricePer1000: number;
};

export const DETAILS_CONCURRENCY = 4;
const FIND_PLACE_RADIUS_M = 1000;
const FIND_PLACE_PAGE_SIZE = 5;
/** Area used when Google returns a location without a viewport (≈10 × 10 km). */
const FALLBACK_GEOCODE_AREA_M = 10_000;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,512}$/;

const toGoogleLatLng = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });
const toGoogleRect = (r: Rect) => ({ low: toGoogleLatLng(r.low), high: toGoogleLatLng(r.high) });

/**
 * Google Places API (New) provider (ARCHITECTURE §4.2). `deps` is for tests (sleep/random/timeouts).
 */
export function createGooglePlacesProvider(opts: GooglePlacesOptions, deps: GooglePlacesDeps = {}): BusinessProvider {
  if (!opts.apiKey) throw new ProviderError("Google Maps is not configured (GOOGLE_MAPS_API_KEY is missing).", "auth");
  const http = new PlacesHttp(opts.apiKey, deps);
  const textPrice = opts.textSearchPricePer1000;
  const detailsPrice = opts.detailsPricePer1000;

  return {
    id: "google_places",
    label: "Google Maps (Places API)",
    isSample: false,

    async geocode(location: string, ctx?: ProviderContext): Promise<GeocodeResult | null> {
      const textQuery = location.trim().slice(0, 500);
      if (!textQuery) return null;
      const data = await http.request(
        { operation: "geocode", method: "POST", path: "/places:searchText", fieldMask: GEOCODE_FIELD_MASK, body: { textQuery, pageSize: 1 }, pricePer1000: textPrice },
        ctx,
      );
      const raw = readPlaces(data)[0];
      if (!raw || typeof raw !== "object") return null;
      const place = raw as { location?: unknown; viewport?: unknown; formattedAddress?: unknown; displayName?: { text?: unknown }; addressComponents?: unknown };
      const center = readLatLng(place.location);
      if (!center) return null;
      const viewport = readViewport(place.viewport) ?? boxAround(center, FALLBACK_GEOCODE_AREA_M);
      const parts = addressParts(place.addressComponents);
      const label = str(place.formattedAddress, 300) ?? str(place.displayName?.text, 300) ?? textQuery;
      return {
        label,
        center,
        viewport,
        ...(parts.city ? { city: parts.city } : {}),
        ...(parts.country ? { country: parts.country } : {}),
        ...(parts.countryCode ? { countryCode: parts.countryCode } : {}),
      };
    },

    async *search(plan: SearchPlan, ctx?: ProviderContext) {
      const textQuery = plan.query.trim().slice(0, 500);
      if (!textQuery) throw new ProviderError("Enter what to search for (for example 'hotel').", "invalid");
      yield* tiledSearch(plan, {
        signal: ctx?.signal,
        onNote: ctx?.onNote,
        searchCell: async (cell, pageToken) => {
          const body = {
            textQuery,
            pageSize: PAGE_SIZE,
            ...(pageToken ? { pageToken } : {}),
            locationRestriction: { rectangle: toGoogleRect(cell) },
            ...(plan.languageCode ? { languageCode: plan.languageCode } : {}),
            ...(plan.regionCode ? { regionCode: plan.regionCode } : {}),
          };
          const data = await http.request(
            { operation: "text_search", method: "POST", path: "/places:searchText", fieldMask: TEXT_SEARCH_FIELD_MASK, body, pricePer1000: textPrice },
            ctx,
          );
          return { places: mapPlaces(data), nextPageToken: readNextPageToken(data) };
        },
      });
    },

    async findPlace(input: { name: string; center?: LatLng }, ctx?: ProviderContext): Promise<ProviderPlace | null> {
      const textQuery = input.name.trim().slice(0, 500);
      if (!textQuery) return null;
      const body = {
        textQuery,
        pageSize: FIND_PLACE_PAGE_SIZE,
        ...(input.center ? { locationBias: { circle: { center: toGoogleLatLng(input.center), radius: FIND_PLACE_RADIUS_M } } } : {}),
      };
      const data = await http.request(
        { operation: "find_place", method: "POST", path: "/places:searchText", fieldMask: FIND_PLACE_FIELD_MASK, body, pricePer1000: textPrice },
        ctx,
      );
      return pickBestMatch(textQuery, input.center, mapPlaces(data));
    },

    async getDetails(ids: string[], ctx?: ProviderContext): Promise<Map<string, ProviderPlace>> {
      const unique = [...new Set(ids.filter((id) => typeof id === "string" && PLACE_ID_RE.test(id)))];
      const found = new Map<string, ProviderPlace>();
      let next = 0;
      let failure: unknown = null;

      const worker = async () => {
        while (failure === null && next < unique.length) {
          const id = unique[next++]!;
          try {
            const data = await http.request(
              { operation: "place_details", method: "GET", path: `/places/${encodeURIComponent(id)}`, fieldMask: DETAILS_FIELD_MASK, pricePer1000: detailsPrice },
              ctx,
            );
            const place = mapPlace(data);
            if (place) found.set(id, place);
          } catch (e) {
            // A removed / malformed place id only affects that row; anything else (key, quota,
            // outage, abort) stops the batch.
            if (e instanceof ProviderError && e.kind === "invalid" && (e.status === 404 || e.status === 400)) continue;
            failure ??= e;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DETAILS_CONCURRENCY, unique.length) }, worker));
      if (failure !== null) throw failure;

      // Stable order: same as requested.
      const out = new Map<string, ProviderPlace>();
      for (const id of unique) {
        const p = found.get(id);
        if (p) out.set(id, p);
      }
      return out;
    },

    estimate(targetCount: number) {
      return estimateGoogleTextSearch(targetCount, textPrice);
    },
  };
}
