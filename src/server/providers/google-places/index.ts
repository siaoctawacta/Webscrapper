// CONTRACT STUB — implemented by the "google" module agent. Keep this export signature.
import type { BusinessProvider } from "../types";

export type GooglePlacesOptions = {
  apiKey: string;
  textSearchPricePer1000: number;
  detailsPricePer1000: number;
};

export function createGooglePlacesProvider(_opts: GooglePlacesOptions): BusinessProvider {
  throw new Error("Google Places provider not implemented yet");
}
