/** Pure name/distance matching used by findPlace to pick the business a place link points at. */
import type { LatLng } from "@/lib/domain";
import type { ProviderPlace } from "../types";
import { haversineMeters } from "./geo";

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, "");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      hits += 1;
      counts.set(g, n - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/** 0..1 similarity, robust to accents, case, punctuation and word order. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  const sameWords = tx.size === ty.size && [...tx].every((t) => ty.has(t));
  if (sameWords) return 0.95;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const contained = short.length >= 4 && ` ${long} `.includes(` ${short} `);
  return Math.max(contained ? 0.85 : 0, dice(x, y));
}

export type MatchCandidate = { place: ProviderPlace; similarity: number; distanceM: number | null; score: number };

/**
 * Pick the candidate that best matches a place link: name similarity first, distance to the link's
 * pin second. A place-link name may carry an address after a comma ("Hotel X, Rue Y"), so the part
 * before the first comma is also compared. Returns null when nothing is a credible match — we would
 * rather say "not found" than attach the wrong business.
 */
export function pickBestMatch(name: string, center: LatLng | undefined, candidates: ProviderPlace[]): ProviderPlace | null {
  const head = name.split(",")[0] ?? name;
  let best: MatchCandidate | null = null;
  for (const place of candidates) {
    const similarity = place.name ? Math.max(nameSimilarity(name, place.name), nameSimilarity(head, place.name)) : 0;
    const distanceM = center && place.lat !== null && place.lng !== null ? haversineMeters(center, { lat: place.lat, lng: place.lng }) : null;
    const proximity = distanceM === null ? 0.5 : distanceM <= 50 ? 1 : Math.max(0, 1 - distanceM / 1500);
    const credible = similarity >= 0.5 || (distanceM !== null && distanceM <= 150);
    if (!credible) continue;
    const score = 0.7 * similarity + 0.3 * proximity;
    if (!best || score > best.score) best = { place, similarity, distanceM, score };
  }
  return best?.place ?? null;
}
