import { EARTH_RADIUS_M, M_PER_DEG_LAT, isLat, isLng } from "./geo";
import { nameKey, sortedWords, stringSimilarity } from "./text";
import type { DuplicateCandidate } from "./types";
import { isSharedPlatformHost } from "./url";

/** Name similarity at or above which two nearby records are probable duplicates. */
export const DUPLICATE_NAME_SIMILARITY = 0.9;
/** Maximum distance for the name rule. */
export const DUPLICATE_MAX_DISTANCE_M = 80;

const MAX_D2 = DUPLICATE_MAX_DISTANCE_M * DUPLICATE_MAX_DISTANCE_M;

/** Union-find where the smallest index is always the root (so "the earlier record wins"). */
class MinRootSets {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    // path compression
    let c = i;
    while (this.parent[c] !== r) {
      const next = this.parent[c]!;
      this.parent[c] = r;
      c = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

/**
 * Probable duplicates among records that already have distinct provider IDs.
 * Two records are linked when they share an E.164 phone, share a website host (ignoring shared
 * platforms such as facebook.com), or have names at least 90% similar and are less than 80 m apart.
 * Links are transitive; every record of a group maps to the group's earliest record.
 * Returns duplicateId → originalId. Never merges anything — callers only flag for review.
 *
 * Runs in roughly O(n) with hashing for phone/host and a spatial grid for the name rule.
 */
export function findProbableDuplicates(records: DuplicateCandidate[]): Map<string, string> {
  const n = records.length;
  const sets = new MinRootSets(n);
  const byPhone = new Map<string, number>();
  const byHost = new Map<string, number>();

  // Spatial grid for the name rule. Cell width in longitude is sized for the highest latitude present
  // so that the 3×3 neighbourhood always covers DUPLICATE_MAX_DISTANCE_M.
  let maxAbsLat = 0;
  for (const r of records) if (isLat(r.lat) && isLng(r.lng)) maxAbsLat = Math.max(maxAbsLat, Math.abs(r.lat));
  const dLat = DUPLICATE_MAX_DISTANCE_M / M_PER_DEG_LAT;
  const dLng = DUPLICATE_MAX_DISTANCE_M / (M_PER_DEG_LAT * Math.max(0.05, Math.cos((maxAbsLat * Math.PI) / 180)));
  const grid = new Map<string, number[]>();
  const keys: (string | null)[] = new Array(n).fill(null);
  const sortedKeys: (string | null)[] = new Array(n).fill(null);
  // Local metric coordinates (equirectangular) so the hot loop does plain arithmetic.
  const ys = new Float64Array(n);
  const xs = new Float64Array(n);
  const cosLat = new Float64Array(n);
  const radM = (Math.PI / 180) * EARTH_RADIUS_M;

  for (let i = 0; i < n; i++) {
    const r = records[i]!;
    if (r.phoneE164) {
      const prev = byPhone.get(r.phoneE164);
      if (prev === undefined) byPhone.set(r.phoneE164, i);
      else if (records[prev]!.id !== r.id) sets.union(prev, i);
    }
    const host = r.websiteHost?.toLowerCase().replace(/^www\./, "") ?? null;
    if (host && !isSharedPlatformHost(host)) {
      const prev = byHost.get(host);
      if (prev === undefined) byHost.set(host, i);
      else if (records[prev]!.id !== r.id) sets.union(prev, i);
    }
    if (!r.name || !isLat(r.lat) || !isLng(r.lng)) continue;
    const key = nameKey(r.name);
    if (!key) continue;
    keys[i] = key;
    const sorted = sortedWords(key);
    sortedKeys[i] = sorted;
    ys[i] = r.lat * radM;
    xs[i] = r.lng * radM;
    cosLat[i] = Math.cos((r.lat * Math.PI) / 180);
    const yi = ys[i]!;
    const xi = xs[i]!;
    const ci = cosLat[i]!;
    const la = key.length;
    const gy = Math.floor(r.lat / dLat);
    const gx = Math.floor(r.lng / dLng);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = grid.get(`${gx + ox}:${gy + oy}`);
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const j = bucket[b]!;
          const kj = keys[j]!;
          // Cheap length filter: Levenshtein similarity ≤ shorter/longer (also for the word-sorted form).
          const lb = kj.length;
          if ((la < lb ? la / lb : lb / la) < DUPLICATE_NAME_SIMILARITY) continue;
          const dy = ys[j]! - yi;
          const dx = (xs[j]! - xi) * ((cosLat[j]! + ci) / 2);
          if (dx * dx + dy * dy >= MAX_D2) continue;
          if (records[j]!.id === r.id) continue;
          if (sets.find(i) === sets.find(j)) continue;
          const sj = sortedKeys[j]!;
          const similar =
            sorted === sj ||
            stringSimilarity(key, kj, DUPLICATE_NAME_SIMILARITY) >= DUPLICATE_NAME_SIMILARITY ||
            (sorted !== key || sj !== kj ? stringSimilarity(sorted, sj, DUPLICATE_NAME_SIMILARITY) >= DUPLICATE_NAME_SIMILARITY : false);
          if (similar) sets.union(j, i);
        }
      }
    }
    const cellKey = `${gx}:${gy}`;
    const bucket = grid.get(cellKey);
    if (bucket) bucket.push(i);
    else grid.set(cellKey, [i]);
  }

  const out = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const root = sets.find(i);
    if (root !== i && records[root]!.id !== records[i]!.id) out.set(records[i]!.id, records[root]!.id);
  }
  return out;
}
