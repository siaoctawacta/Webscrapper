/**
 * Small deterministic PRNG toolkit (pure): xmur3 string hashing + mulberry32 generator.
 * The same seed string always yields the same sequence on every platform.
 */

/** xmur3 string hash → 32-bit unsigned integer. */
export function hash32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Deterministic random source seeded from a string. */
export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = (typeof seed === "number" ? seed : hash32(seed)) >>> 0;
  }

  /** mulberry32: uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty list");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Weighted choice; weights need not sum to 1. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    const last = items[items.length - 1];
    if (!last) throw new Error("Rng.weighted: empty list");
    return last[0];
  }

  /** Standard normal deviate (Box–Muller). */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** String of `n` random decimal digits. */
  digits(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) s += String(Math.floor(this.next() * 10));
    return s;
  }
}

/** Short base-36 token derived from a string (stable, e.g. for unique-looking slugs). */
export function token36(str: string, length = 4): string {
  let s = hash32(str).toString(36);
  let salt = 0;
  while (s.length < length) s += hash32(`${str}#${++salt}`).toString(36);
  return s.slice(0, length);
}
