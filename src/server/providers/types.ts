import type { FoundEmail, LatLng, Rect, Socials, SourceId, WebsiteCheck } from "@/lib/domain";

/** A business as returned by a provider, before normalization. */
export interface ProviderPlace {
  /** Stable provider identifier (Google place ID, sample ID). */
  sourceRecordId: string;
  name: string | null;
  /** Human-readable primary category, e.g. "Hotel". */
  category: string | null;
  /** All provider categories/types, most specific first. */
  categories: string[];
  phoneNational: string | null;
  phoneInternational: string | null;
  websiteUrl: string | null;
  /** Only when the provider itself supplies an email (Google does not). */
  email: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, used to parse local phone numbers. */
  countryCode: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  businessStatus: string | null;
  /**
   * Sample provider only: pre-computed enrichment so sample mode never crawls the real internet.
   * Real providers leave this undefined and the website crawler fills enrichment.
   */
  sampleEnrichment?: { emails: FoundEmail[]; socials: Socials; websiteCheck: WebsiteCheck | null };
}

export interface GeocodeResult {
  label: string;
  center: LatLng;
  viewport: Rect;
  city?: string;
  country?: string;
  countryCode?: string;
}

export interface SearchPlan {
  /** What to search for, e.g. "hôtel". */
  query: string;
  /** Area to cover. Tiled into smaller cells when more results are wanted than one query returns. */
  area: Rect;
  center: LatLng;
  targetCount: number;
  /** Hard cap on billable requests for this job (cost control). */
  maxRequests: number;
  languageCode?: string;
  regionCode?: string;
}

export interface SearchPage {
  places: ProviderPlace[];
  /** Progress through the area. tilesTotal may grow as dense cells are subdivided. */
  tilesDone: number;
  tilesTotal: number;
  /** True when the provider has nothing more for this area. */
  exhausted?: boolean;
}

export type UsageEvent = {
  operation: "text_search" | "place_details" | "geocode" | "find_place";
  requests: number;
  costUsd: number;
  billable: boolean;
};

export interface ProviderContext {
  signal?: AbortSignal;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Called once per provider HTTP request so usage and cost are recorded accurately. */
  onUsage?: (u: UsageEvent) => void | Promise<void>;
  /** Called by search() when it stops early, e.g. "Request budget reached". */
  onNote?: (message: string) => void;
}

export interface CostEstimateResult {
  estimatedRequests: number;
  maxRequests: number;
  estimatedCostUsd: number;
  /** Free monthly allowance on the provider side, if any (informational). */
  freeMonthlyRequests: number | null;
  notes: string[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** "auth" (bad key/billing), "quota" (rate limited), "invalid" (bad request), "unavailable" (5xx/network). */
    public kind: "auth" | "quota" | "invalid" | "unavailable",
    public status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface BusinessProvider {
  id: SourceId;
  label: string;
  isSample: boolean;
  /** Turn a free-text location ("Lomé, Togo") into an area to search. Null if not found. */
  geocode(location: string, ctx?: ProviderContext): Promise<GeocodeResult | null>;
  /**
   * Stream result pages until targetCount unique places are produced, maxRequests is reached,
   * the area is exhausted, or ctx.signal aborts. Duplicates across pages/tiles are allowed
   * (the caller de-duplicates by sourceRecordId).
   */
  search(plan: SearchPlan, ctx?: ProviderContext): AsyncIterable<SearchPage>;
  /** Find the single business a Google Maps place link points to. */
  findPlace(input: { name: string; center?: LatLng }, ctx?: ProviderContext): Promise<ProviderPlace | null>;
  /** Live details by provider ID (used to display fields that may not be stored). */
  getDetails(ids: string[], ctx?: ProviderContext): Promise<Map<string, ProviderPlace>>;
  estimate(targetCount: number): CostEstimateResult;
}
