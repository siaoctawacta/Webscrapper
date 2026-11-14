/**
 * Pure rectangle helpers for tiling. Rectangles follow the Places API convention: low = south-west,
 * high = north-east; low.lng > high.lng means the rectangle crosses the 180° meridian.
 */
import type { LatLng, Rect } from "@/lib/domain";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function wrapLng(lng: number): number {
  if (lng >= -180 && lng <= 180) return lng;
  const w = ((((lng + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lng > 0 ? 180 : w;
}

export function lngSpan(r: Rect): number {
  return r.high.lng >= r.low.lng ? r.high.lng - r.low.lng : r.high.lng + 360 - r.low.lng;
}

export function latSpan(r: Rect): number {
  return r.high.lat - r.low.lat;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Width and height in meters, measured through the middle of the rectangle. */
export function rectSizeMeters(r: Rect): { width: number; height: number } {
  const midLat = (r.low.lat + r.high.lat) / 2;
  return {
    width: toRad(lngSpan(r)) * EARTH_RADIUS_M * Math.cos(toRad(midLat)),
    height: toRad(Math.abs(latSpan(r))) * EARTH_RADIUS_M,
  };
}

export function rectAreaKm2(r: Rect): number {
  const { width, height } = rectSizeMeters(r);
  return Math.max((width * height) / 1e6, 1e-9);
}

export function rectContains(r: Rect, lat: number, lng: number): boolean {
  if (lat < r.low.lat || lat > r.high.lat) return false;
  return r.low.lng <= r.high.lng ? lng >= r.low.lng && lng <= r.high.lng : lng >= r.low.lng || lng <= r.high.lng;
}

/** A square-ish box of `meters` on each side around a point. */
export function boxAround(center: LatLng, meters: number): Rect {
  const dLat = meters / 2 / 111_320;
  const dLng = meters / 2 / (111_320 * Math.max(0.01, Math.cos(toRad(center.lat))));
  return {
    low: { lat: Math.max(-90, center.lat - dLat), lng: wrapLng(center.lng - dLng) },
    high: { lat: Math.min(90, center.lat + dLat), lng: wrapLng(center.lng + dLng) },
  };
}

/** Quadtree split → [south-west, south-east, north-west, north-east]. */
export function splitRect(r: Rect): [Rect, Rect, Rect, Rect] {
  const midLat = (r.low.lat + r.high.lat) / 2;
  const midLng = wrapLng(r.low.lng + lngSpan(r) / 2);
  return [
    { low: { lat: r.low.lat, lng: r.low.lng }, high: { lat: midLat, lng: midLng } },
    { low: { lat: r.low.lat, lng: midLng }, high: { lat: midLat, lng: r.high.lng } },
    { low: { lat: midLat, lng: r.low.lng }, high: { lat: r.high.lat, lng: midLng } },
    { low: { lat: midLat, lng: midLng }, high: { lat: r.high.lat, lng: r.high.lng } },
  ];
}

/**
 * Make a search area safe to send: clamp coordinates, order corners, and give degenerate areas
 * (a single point) a minimum size around the center.
 */
export function normalizeArea(area: Rect, center: LatLng, minMeters: number): Rect {
  const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
  const lowLat = clampLat(Math.min(area.low.lat, area.high.lat));
  const highLat = clampLat(Math.max(area.low.lat, area.high.lat));
  const r: Rect = {
    low: { lat: lowLat, lng: wrapLng(area.low.lng) },
    high: { lat: highLat, lng: wrapLng(area.high.lng) },
  };
  const valid = [lowLat, highLat, r.low.lng, r.high.lng].every(Number.isFinite);
  const size = valid ? rectSizeMeters(r) : { width: 0, height: 0 };
  if (!valid || size.width < 1 || size.height < 1) {
    const c = Number.isFinite(center.lat) && Number.isFinite(center.lng) ? center : { lat: 0, lng: 0 };
    return boxAround(c, minMeters);
  }
  return r;
}
