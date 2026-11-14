import { describe, expect, it } from "vitest";
import type { LatLng, Rect } from "@/lib/domain";
import type { ProviderContext, SearchPage, SearchPlan, UsageEvent } from "../types";
import { estimateGoogleTextSearch } from "./estimate";
import { rectContains, rectSizeMeters, splitRect } from "./geo";
import { createGooglePlacesProvider } from "./index";

/**
 * A fake Places API (New) Text Search: filters a synthetic dataset by the request's
 * locationRestriction rectangle, ranks by a fixed "relevance" order, and serves at most 60 results
 * per query in pages of 20 (no next page token after page 3, like the real API).
 */
type FakePlace = { id: string; lat: number; lng: number };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function scatter(n: number, area: Rect, seed: number, prefix = "p"): FakePlace[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    lat: area.low.lat + r() * (area.high.lat - area.low.lat),
    lng: area.low.lng + r() * (area.high.lng - area.low.lng),
  }));
}

function fakeGoogle(dataset: FakePlace[]) {
  // Stable pseudo-relevance, independent of position.
  const relevance = new Map(dataset.map((p, i) => [p.id, (i * 2654435761) % 1_000_003]));
  const requests: { rect: Rect; pageToken: string | undefined }[] = [];
  const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      pageToken?: string;
      locationRestriction: { rectangle: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } };
    };
    const { low, high } = body.locationRestriction.rectangle;
    const rect: Rect = { low: { lat: low.latitude, lng: low.longitude }, high: { lat: high.latitude, lng: high.longitude } };
    requests.push({ rect, pageToken: body.pageToken });
    const inside = dataset
      .filter((p) => rectContains(rect, p.lat, p.lng))
      .sort((a, b) => relevance.get(a.id)! - relevance.get(b.id)!)
      .slice(0, 60);
    const offset = body.pageToken ? Number(body.pageToken.split(":")[1]) : 0;
    const slice = inside.slice(offset, offset + 20);
    const next = offset + 20 < inside.length ? { nextPageToken: `o:${offset + 20}` } : {};
    const places = slice.map((p) => ({
      id: p.id,
      displayName: { text: `Business ${p.id}` },
      location: { latitude: p.lat, longitude: p.lng },
      primaryTypeDisplayName: { text: "Hotel" },
    }));
    return new Response(JSON.stringify({ places, ...next }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

const AREA: Rect = { low: { lat: 6.0063, lng: 0.946 }, high: { lat: 6.2802, lng: 1.3855 } }; // ≈49 × 30 km around Lomé
const CENTER: LatLng = { lat: 6.1433903, lng: 1.1657635 };

async function run(dataset: FakePlace[], plan: Partial<SearchPlan>) {
  const g = fakeGoogle(dataset);
  const usage: UsageEvent[] = [];
  const notes: string[] = [];
  const provider = createGooglePlacesProvider({ apiKey: "test-key", textSearchPricePer1000: 35, detailsPricePer1000: 20 }, { sleep: async () => {} });
  const ctx: ProviderContext = { fetch: g.fetch, onUsage: (u) => void usage.push(u), onNote: (n) => void notes.push(n) };
  const pages: SearchPage[] = [];
  const full: SearchPlan = { query: "hotel", area: AREA, center: CENTER, targetCount: 100, maxRequests: 100, ...plan };
  for await (const p of provider.search(full, ctx)) pages.push(p);
  const unique = new Set(pages.flatMap((p) => p.places.map((x) => x.sourceRecordId)));
  return { pages, unique, requests: g.requests, usage, notes };
}

const within = (inner: Rect, outer: Rect) =>
  inner.low.lat >= outer.low.lat - 1e-9 &&
  inner.high.lat <= outer.high.lat + 1e-9 &&
  inner.low.lng >= outer.low.lng - 1e-9 &&
  inner.high.lng <= outer.high.lng + 1e-9;

describe("adaptive quadtree tiling", () => {
  it("subdivides saturated cells until the target is reached, within the request budget", async () => {
    const dataset = scatter(1500, AREA, 7);
    const est = estimateGoogleTextSearch(300, 35);
    const r = await run(dataset, { targetCount: 300, maxRequests: est.maxRequests });

    expect(r.unique.size).toBeGreaterThanOrEqual(300);
    expect(r.requests.length).toBeLessThanOrEqual(est.maxRequests);
    expect(r.usage).toHaveLength(r.requests.length);
    expect(r.usage.every((u) => u.operation === "text_search" && u.billable)).toBe(true);
    const last = r.pages.at(-1)!;
    expect(last.tilesTotal).toBeGreaterThan(1);
    expect(last.tilesDone).toBeLessThanOrEqual(last.tilesTotal);
    expect(last.exhausted).toBeUndefined();
    // Every request stays inside the requested area; the first three page through the whole area.
    expect(r.requests.every((q) => within(q.rect, AREA))).toBe(true);
    expect(r.requests.slice(0, 3).map((q) => q.pageToken)).toEqual([undefined, "o:20", "o:40"]);
    expect(r.requests[3]!.pageToken).toBeUndefined();
    // Progress counters never go backwards.
    for (let i = 1; i < r.pages.length; i++) {
      expect(r.pages[i]!.tilesDone).toBeGreaterThanOrEqual(r.pages[i - 1]!.tilesDone);
      expect(r.pages[i]!.tilesTotal).toBeGreaterThanOrEqual(r.pages[i - 1]!.tilesTotal);
    }
  });

  it("stops at maxRequests and leaves a note", async () => {
    const r = await run(scatter(1500, AREA, 11), { targetCount: 5000, maxRequests: 7 });
    expect(r.requests).toHaveLength(7);
    expect(r.usage).toHaveLength(7);
    expect(r.notes.join(" ")).toMatch(/Request budget reached \(7 requests\)/);
    expect(r.pages.at(-1)!.exhausted).toBeUndefined();
  });

  it("exhausts a sparse area without splitting", async () => {
    const r = await run(scatter(45, AREA, 3), { targetCount: 500 });
    expect(r.requests).toHaveLength(3);
    expect(r.unique.size).toBe(45);
    expect(r.pages.at(-1)).toMatchObject({ tilesDone: 1, tilesTotal: 1, exhausted: true });
  });

  it("searches the densest child first", async () => {
    const [, , , ne] = splitRect(AREA);
    const dataset = [...scatter(400, ne, 5, "ne"), ...scatter(20, AREA, 9, "x")];
    const r = await run(dataset, { targetCount: 200 });
    expect(r.requests[3]!.rect).toEqual(ne);
    expect(r.unique.size).toBeGreaterThanOrEqual(200);
  });

  it("covers every cell of a moderately dense area and reports exhaustion", async () => {
    const r = await run(scatter(150, AREA, 21), { targetCount: 1000, maxRequests: 500 });
    expect(r.unique.size).toBe(150);
    const last = r.pages.at(-1)!;
    expect(last.exhausted).toBe(true);
    expect(last.tilesDone).toBe(last.tilesTotal);
    expect(last.tilesTotal).toBeGreaterThan(1);
  });

  it("does not split cells below ~300 m, even if they stay saturated", async () => {
    const spot: Rect = { low: { lat: 6.1300, lng: 1.2550 }, high: { lat: 6.13045, lng: 1.25545 } }; // ≈50 m
    const area: Rect = { low: { lat: 6.121, lng: 1.246 }, high: { lat: 6.139, lng: 1.264 } }; // ≈2 km
    const r = await run(scatter(200, spot, 13), { area, targetCount: 1000, maxRequests: 500 });
    const smallest = Math.min(...r.requests.map((q) => Math.max(rectSizeMeters(q.rect).width, rectSizeMeters(q.rect).height)));
    expect(smallest).toBeGreaterThanOrEqual(300);
    expect(r.requests.length).toBeLessThan(60);
    expect(r.pages.at(-1)!.exhausted).toBe(true);
    expect(r.notes.join(" ")).toMatch(/very dense spots/);
  });

  it("does not tile when 60 or fewer results are wanted", async () => {
    const r = await run(scatter(1500, AREA, 17), { targetCount: 60 });
    expect(r.requests).toHaveLength(3);
    expect(r.unique.size).toBe(60);
    expect(r.pages.at(-1)!.tilesTotal).toBe(1);
  });
});
