/**
 * Offline geocoder for the sample provider (pure). Matches the built-in city table
 * accent/case-insensitively (with aliases and country names); anything else becomes a
 * deterministic pseudo-location with a 20 km map area, labelled exactly as the user typed it.
 */
import type { LatLng, Rect } from "@/lib/domain";
import { M_PER_DEG_LAT, offsetMeters } from "@/server/normalize/geo";
import { cleanText, foldText } from "@/server/normalize/text";
import type { GeocodeResult } from "../types";
import { CITIES, COUNTRIES, cityViewport, type CityDef, type CountryDef } from "./places-data";
import { Rng } from "./prng";
import { regionAt } from "./world";

const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180);

/** Square map area of `halfKm` around a point. */
export function squareAround(center: LatLng, halfKm: number): Rect {
  const dLat = (halfKm * 1000) / M_PER_DEG_LAT;
  const dLng = (halfKm * 1000) / (M_PER_DEG_LAT * Math.max(0.01, cosDeg(center.lat)));
  return { low: { lat: center.lat - dLat, lng: center.lng - dLng }, high: { lat: center.lat + dLat, lng: center.lng + dLng } };
}

type Match<T> = { item: T; pos: number; len: number };

function findAlias<T>(folded: string, items: readonly T[], aliasesOf: (t: T) => string[]): Match<T> | null {
  const hay = ` ${folded} `;
  let best: Match<T> | null = null;
  for (const item of items) {
    for (const alias of aliasesOf(item)) {
      const a = foldText(alias);
      if (!a) continue;
      const pos = hay.indexOf(` ${a} `);
      if (pos < 0) continue;
      if (!best || a.length > best.len || (a.length === best.len && pos < best.pos)) best = { item, pos, len: a.length };
    }
  }
  return best;
}

const COUNTRY_LIST = Object.values(COUNTRIES);
const cityAliases = (c: CityDef) => [c.name, ...c.aliases];
const countryAliases = (c: CountryDef) => [c.name, ...c.aliases];

function cityResult(c: CityDef): GeocodeResult {
  const country = COUNTRIES[c.country]!;
  return { label: `${c.name}, ${country.name}`, center: { ...c.center }, viewport: cityViewport(c), city: c.name, country: country.name, countryCode: country.code };
}

const COORDS_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Deterministic location for a place name the table does not know. */
function pseudoLocation(label: string, country: CountryDef | null): GeocodeResult {
  const rng = new Rng(`geocode|${foldText(label)}`);
  const anchors = country ? CITIES.filter((c) => c.country === country.code) : CITIES;
  const anchor = rng.pick(anchors.length ? anchors : CITIES);
  const anchorCountry = COUNTRIES[anchor.country]!;
  // 35–55 km from a known city (outside its map area); keep the nearest city in the same country.
  let center = offsetMeters(anchor.center, rng.float(35_000, 55_000), rng.float(0, 360));
  for (let i = 0; i < 8 && regionAt(center.lat, center.lng).city.country.code !== anchorCountry.code; i++) {
    center = offsetMeters(anchor.center, rng.float(35_000, 55_000), rng.float(0, 360));
  }
  center = { lat: Math.round(center.lat * 1e6) / 1e6, lng: Math.round(center.lng * 1e6) / 1e6 };
  const firstSegment = cleanText(label.split(",")[0]) ?? label;
  return { label, center, viewport: squareAround(center, 10), city: firstSegment, country: anchorCountry.name, countryCode: anchorCountry.code };
}

/** Resolve a free-text location. Returns null only for empty input. */
export function geocodeLocation(location: string): GeocodeResult | null {
  const label = cleanText(location);
  if (!label) return null;

  const coords = COORDS_RE.exec(label);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
      const center = { lat, lng };
      const region = regionAt(lat, lng);
      return {
        label: `Map area around ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        center,
        viewport: squareAround(center, 5),
        ...(region.inCity ? { city: region.city.def.name } : {}),
        country: region.city.country.name,
        countryCode: region.city.country.code,
      };
    }
  }

  const folded = foldText(label);
  const city = findAlias(folded, CITIES, cityAliases);
  if (city) return cityResult(city.item);

  const country = findAlias(folded, COUNTRY_LIST, countryAliases);
  if (country) {
    const onlyCountry = countryAliases(country.item).some((a) => foldText(a) === folded);
    if (onlyCountry) {
      const main = CITIES.find((c) => c.country === country.item.code);
      if (main) {
        const r = cityResult(main);
        return { label: country.item.name, center: r.center, viewport: r.viewport, country: r.country, countryCode: r.countryCode };
      }
    }
    return pseudoLocation(label, country.item);
  }
  return pseudoLocation(label, null);
}
