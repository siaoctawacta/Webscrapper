/** Pure geographic helpers. */
import type { LatLng } from "@/lib/domain";

export const EARTH_RADIUS_M = 6_371_008.8;
/** Metres per degree of latitude (mean). */
export const M_PER_DEG_LAT = 111_320;

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fast equirectangular approximation, accurate to well under 1% for distances below ~50 km. */
export function approxDistanceMeters(a: LatLng, b: LatLng): number {
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

/** Point `meters` away from `from` in direction `bearingDeg` (0 = north, 90 = east). Small-distance approximation. */
export function offsetMeters(from: LatLng, meters: number, bearingDeg: number): LatLng {
  const b = rad(bearingDeg);
  const dLat = (meters * Math.cos(b)) / M_PER_DEG_LAT;
  const dLng = (meters * Math.sin(b)) / (M_PER_DEG_LAT * Math.max(0.01, Math.cos(rad(from.lat))));
  return { lat: from.lat + dLat, lng: from.lng + dLng };
}

export const isLat = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
export const isLng = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
