import "server-only";
import type { SourceId } from "@/lib/domain";
import { env } from "../env";
import { HttpError } from "../errors";
import { createGooglePlacesProvider } from "./google-places";
import { createSampleProvider } from "./sample";
import type { BusinessProvider } from "./types";

/** The provider new searches use: Google Places when a key is configured, otherwise sample data. */
export function defaultProviderId(): SourceId {
  return env().GOOGLE_MAPS_API_KEY ? "google_places" : "sample";
}

export function getProvider(id: SourceId = defaultProviderId()): BusinessProvider {
  switch (id) {
    case "google_places": {
      const key = env().GOOGLE_MAPS_API_KEY;
      if (!key) throw new HttpError("bad_request", "Google Maps is not configured (GOOGLE_MAPS_API_KEY is missing)");
      return createGooglePlacesProvider({
        apiKey: key,
        textSearchPricePer1000: env().GOOGLE_TEXT_SEARCH_PRICE_PER_1000,
        detailsPricePer1000: env().GOOGLE_PLACE_DETAILS_PRICE_PER_1000,
      });
    }
    case "sample":
      return createSampleProvider();
  }
}

export function availableProviders(): { id: SourceId; label: string; isSample: boolean }[] {
  const out: { id: SourceId; label: string; isSample: boolean }[] = [];
  if (env().GOOGLE_MAPS_API_KEY) out.push({ id: "google_places", label: "Google Maps (Places API)", isSample: false });
  out.push({ id: "sample", label: "Sample data", isSample: true });
  return out;
}
