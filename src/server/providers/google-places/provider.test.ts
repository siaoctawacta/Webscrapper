import { describe, expect, it, vi } from "vitest";
import type { Rect } from "@/lib/domain";
import { ProviderError, type ProviderContext, type SearchPage, type SearchPlan, type UsageEvent } from "../types";
import errors from "./__fixtures__/errors.json";
import findFixture from "./__fixtures__/find-place-sarakawa.json";
import geocodeFixture from "./__fixtures__/geocode-lome.json";
import detailsFixture from "./__fixtures__/place-details-lagon-bleu.json";
import page1 from "./__fixtures__/text-search-lome-hotels-page1.json";
import page2 from "./__fixtures__/text-search-lome-hotels-page2.json";
import { createGooglePlacesProvider, PROVIDER_MESSAGES } from "./index";
import { DETAILS_FIELD_MASK, FIND_PLACE_FIELD_MASK, GEOCODE_FIELD_MASK, TEXT_SEARCH_FIELD_MASK } from "./mapping";

const KEY = "AIzaSyTEST-not-a-real-key-0123456789abcd";
const LOME_AREA: Rect = { low: { lat: 6.0063, lng: 0.9460 }, high: { lat: 6.2802, lng: 1.3855 } };

type Call = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null; signal: AbortSignal | null };
type Reply = Response | Error | ((call: Call) => Response | Error | Promise<Response | Error>);

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

/** fetch mock answering calls in order (the last reply repeats). */
function mockFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    const r = replies[Math.min(calls.length, replies.length) - 1]!;
    const out = typeof r === "function" ? await r(call) : r;
    if (out instanceof Error) throw out;
    // A fresh Response per call (clones share a tee'd body).
    return new Response(await out.clone().text(), { status: out.status, headers: out.headers });
  };
  return { fetch: fn as typeof fetch, calls };
}

function setup(replies: Reply[], extra: Partial<ProviderContext> = {}) {
  const f = mockFetch(replies);
  const usage: UsageEvent[] = [];
  const notes: string[] = [];
  const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {});
  const provider = createGooglePlacesProvider({ apiKey: KEY, textSearchPricePer1000: 35, detailsPricePer1000: 20 }, { sleep, random: () => 0.5 });
  const ctx: ProviderContext = { fetch: f.fetch, onUsage: (u) => void usage.push(u), onNote: (n) => void notes.push(n), ...extra };
  return { provider, ctx, calls: f.calls, usage, notes, sleep };
}

const plan = (over: Partial<SearchPlan> = {}): SearchPlan => ({
  query: "hôtel",
  area: LOME_AREA,
  center: { lat: 6.1433903, lng: 1.1657635 },
  targetCount: 40,
  maxRequests: 10,
  ...over,
});

async function collect(it: AsyncIterable<SearchPage>) {
  const pages: SearchPage[] = [];
  for await (const p of it) pages.push(p);
  return pages;
}

async function rejection(p: Promise<unknown>): Promise<ProviderError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ProviderError);
  return e as ProviderError;
}

describe("search (Text Search New)", () => {
  it("sends the documented request shape and pages with nextPageToken", async () => {
    const t = setup([json(page1), json(page2)]);
    const pages = await collect(t.provider.search(plan({ languageCode: "fr", regionCode: "TG" }), t.ctx));

    expect(t.calls).toHaveLength(2);
    const [first, second] = t.calls;
    expect(first!.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(first!.method).toBe("POST");
    expect(first!.headers.get("X-Goog-Api-Key")).toBe(KEY);
    expect(first!.headers.get("X-Goog-FieldMask")).toBe(TEXT_SEARCH_FIELD_MASK);
    expect(first!.headers.get("Content-Type")).toBe("application/json");
    expect(first!.url).not.toContain(KEY);
    expect(first!.body).toEqual({
      textQuery: "hôtel",
      pageSize: 20,
      locationRestriction: {
        rectangle: { low: { latitude: 6.0063, longitude: 0.946 }, high: { latitude: 6.2802, longitude: 1.3855 } },
      },
      languageCode: "fr",
      regionCode: "TG",
    });
    expect(second!.body).toEqual({ ...first!.body, pageToken: page1.nextPageToken });

    expect(pages.map((p) => p.places.length)).toEqual([20, 7]);
    expect(pages[0]).toMatchObject({ tilesDone: 0, tilesTotal: 1 });
    expect(pages[0]!.exhausted).toBeUndefined();
    expect(pages[1]).toMatchObject({ tilesDone: 1, tilesTotal: 1, exhausted: true });
    expect(pages[0]!.places[0]).toMatchObject({ sourceRecordId: page1.places[0]!.id, name: "Hôtel Le Lagon Bleu", city: "Lomé", countryCode: "TG" });

    expect(t.usage).toEqual([
      { operation: "text_search", requests: 1, costUsd: 0.035, billable: true },
      { operation: "text_search", requests: 1, costUsd: 0.035, billable: true },
    ]);
  });

  it("stops as soon as the target is reached", async () => {
    const t = setup([json(page1), json(page2)]);
    const pages = await collect(t.provider.search(plan({ targetCount: 20 }), t.ctx));
    expect(t.calls).toHaveLength(1);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.exhausted).toBeUndefined();
  });

  it("never tiles for targets ≤ 60, even when a cell is saturated", async () => {
    // Google keeps offering more pages of the same 20 places.
    const t = setup([json(page1)]);
    const pages = await collect(t.provider.search(plan({ targetCount: 50 }), t.ctx));
    expect(t.calls).toHaveLength(3);
    expect(pages.at(-1)).toMatchObject({ tilesDone: 1, tilesTotal: 1, exhausted: true });
    expect(t.usage).toHaveLength(3);
  });

  it("rejects an empty query when iterated", async () => {
    const t = setup([json(page1)]);
    const e = await rejection(collect(t.provider.search(plan({ query: "  " }), t.ctx)));
    expect(e.kind).toBe("invalid");
    expect(t.calls).toHaveLength(0);
  });

  it("stops on maxRequests and says so", async () => {
    const t = setup([json(page1), json(page2)]);
    await collect(t.provider.search(plan({ targetCount: 40, maxRequests: 1 }), t.ctx));
    expect(t.calls).toHaveLength(1);
    expect(t.notes.join(" ")).toMatch(/Request budget reached/);
  });
});

describe("errors and retries", () => {
  it("maps 400 API_KEY_INVALID to an auth error without retrying", async () => {
    const t = setup([json(errors.apiKeyInvalid, 400)]);
    const e = await rejection(collect(t.provider.search(plan(), t.ctx)));
    expect(e.kind).toBe("auth");
    expect(e.status).toBe(400);
    expect(e.message).toContain("Google rejected the API key or billing is not enabled for Places API (New).");
    expect(e.message).toContain("not valid");
    expect(t.calls).toHaveLength(1);
    expect(t.sleep).not.toHaveBeenCalled();
    expect(t.usage).toEqual([{ operation: "text_search", requests: 1, costUsd: 0, billable: false }]);
  });

  it("maps 403 SERVICE_DISABLED / BILLING_DISABLED to auth errors that explain the fix", async () => {
    const a = setup([json(errors.serviceDisabled, 403)]);
    const ea = await rejection(collect(a.provider.search(plan(), a.ctx)));
    expect(ea.kind).toBe("auth");
    expect(ea.message).toContain(PROVIDER_MESSAGES.serviceDisabled);

    const b = setup([json(errors.billingDisabled, 403)]);
    const eb = await rejection(b.provider.geocode("Lomé", b.ctx));
    expect(eb.kind).toBe("auth");
    expect(eb.message).toContain("billing");

    const c = setup([new Response("Forbidden", { status: 401 })]);
    expect((await rejection(c.provider.geocode("Lomé", c.ctx))).kind).toBe("auth");
  });

  it("maps other 400s to invalid with Google's explanation", async () => {
    const t = setup([json(errors.invalidArgument, 400)]);
    const e = await rejection(collect(t.provider.search(plan(), t.ctx)));
    expect(e.kind).toBe("invalid");
    expect(e.message).toMatch(/^Google could not process this request: Invalid value at 'location_restriction/);
    expect(t.calls).toHaveLength(1);
  });

  it("retries 429 with backoff and reports quota after 3 attempts", async () => {
    const t = setup([json(errors.quota, 429)]);
    const e = await rejection(collect(t.provider.search(plan(), t.ctx)));
    expect(e.kind).toBe("quota");
    expect(e.status).toBe(429);
    expect(e.message).toBe(PROVIDER_MESSAGES.quota);
    expect(t.calls).toHaveLength(3);
    // Exponential: 500 ms × 2^(attempt-1) × (0.5 + jitter 0.5).
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
    expect(t.usage).toHaveLength(3);
    expect(t.usage.every((u) => !u.billable && u.costUsd === 0)).toBe(true);
  });

  it("honours Retry-After", async () => {
    const t = setup([json(errors.quota, 429, { "retry-after": "3" }), json(page2)]);
    const pages = await collect(t.provider.search(plan(), t.ctx));
    expect(pages).toHaveLength(1);
    expect(t.sleep.mock.calls[0]![0]).toBe(3000);
  });

  it("recovers from a 500 and from network errors", async () => {
    const t = setup([json(errors.internal, 500), new TypeError("fetch failed"), json(page2)]);
    const pages = await collect(t.provider.search(plan(), t.ctx));
    expect(pages[0]!.places).toHaveLength(7);
    expect(t.calls).toHaveLength(3);
    expect(t.sleep).toHaveBeenCalledTimes(2);
    expect(t.usage.map((u) => u.billable)).toEqual([false, false, true]);
  });

  it("reports unavailable after repeated 5xx / network failures", async () => {
    const a = setup([json(errors.internal, 503)]);
    const ea = await rejection(collect(a.provider.search(plan(), a.ctx)));
    expect(ea.kind).toBe("unavailable");
    expect(a.calls).toHaveLength(3);

    const b = setup([new TypeError("fetch failed")]);
    const eb = await rejection(b.provider.findPlace({ name: "Hotel Sarakawa" }, b.ctx));
    expect(eb.kind).toBe("unavailable");
    expect(eb.message).toBe(PROVIDER_MESSAGES.unavailable);
    expect(b.calls).toHaveLength(3);
    expect(b.usage).toHaveLength(3);
  });

  it("never puts the API key in error messages", async () => {
    const echo = { error: { code: 400, message: `Request with key ${KEY} and AIzaSyOtherKeyOtherKeyOtherKey123 is malformed`, status: "INVALID_ARGUMENT" } };
    const t = setup([json(echo, 400)]);
    const e = await rejection(collect(t.provider.search(plan(), t.ctx)));
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toContain("AIzaSyOtherKey");
    expect(e.message).toContain("[redacted]");
  });

  it("treats an unreadable success body as unavailable", async () => {
    const t = setup([new Response("<html>oops</html>", { status: 200 })]);
    expect((await rejection(t.provider.geocode("Lomé", t.ctx))).kind).toBe("unavailable");
  });
});

describe("abort", () => {
  it("stops between pages when the caller aborts", async () => {
    const ac = new AbortController();
    const t = setup([json(page1), json(page2)], { signal: ac.signal });
    const pages: SearchPage[] = [];
    for await (const p of t.provider.search(plan(), t.ctx)) {
      pages.push(p);
      ac.abort();
    }
    expect(pages).toHaveLength(1);
    expect(t.calls).toHaveLength(1);
  });

  it("ends quietly when aborted during a request", async () => {
    const ac = new AbortController();
    const t = setup(
      [
        (call) =>
          new Promise<Error>((resolve) => {
            call.signal?.addEventListener("abort", () => resolve(new DOMException("aborted", "AbortError")));
            setTimeout(() => ac.abort(), 5);
          }),
      ],
      { signal: ac.signal },
    );
    const pages = await collect(t.provider.search(plan(), t.ctx));
    expect(pages).toEqual([]);
    expect(t.calls).toHaveLength(1);
    expect(t.usage).toHaveLength(1);
  });

  it("rejects lookups with an already-aborted signal without calling Google", async () => {
    const ac = new AbortController();
    ac.abort(new DOMException("cancelled", "AbortError"));
    const t = setup([json(geocodeFixture)], { signal: ac.signal });
    await expect(t.provider.geocode("Lomé", t.ctx)).rejects.toMatchObject({ name: "AbortError" });
    await expect(t.provider.getDetails(["ChIJabc"], t.ctx)).rejects.toMatchObject({ name: "AbortError" });
    expect(t.calls).toHaveLength(0);
  });
});

describe("geocode", () => {
  it("returns label, center and Google's viewport", async () => {
    const t = setup([json(geocodeFixture)]);
    const g = await t.provider.geocode("  Lomé, Togo ", t.ctx);
    expect(g).toEqual({
      label: "Lomé, Togo",
      center: { lat: 6.1256261, lng: 1.2254183 },
      viewport: { low: { lat: 6.0960581, lng: 1.1337852 }, high: { lat: 6.2353937, lng: 1.3110569 } },
      city: "Lomé",
      country: "Togo",
      countryCode: "TG",
    });
    expect(t.calls[0]!.headers.get("X-Goog-FieldMask")).toBe(GEOCODE_FIELD_MASK);
    expect(t.calls[0]!.body).toEqual({ textQuery: "Lomé, Togo", pageSize: 1 });
    expect(t.usage).toEqual([{ operation: "geocode", requests: 1, costUsd: 0.035, billable: true }]);
  });

  it("returns null when Google finds nothing, and builds an area when no viewport is given", async () => {
    const none = setup([json({})]);
    expect(await none.provider.geocode("Nowhere-ville", none.ctx)).toBeNull();
    expect(await none.provider.geocode("   ", none.ctx)).toBeNull();
    expect(none.calls).toHaveLength(1);

    const noViewport = setup([json({ places: [{ location: { latitude: 5.6037, longitude: -0.187 }, displayName: { text: "Accra" } }] })]);
    const g = (await noViewport.provider.geocode("Accra", noViewport.ctx))!;
    expect(g.label).toBe("Accra");
    expect(g.viewport.low.lat).toBeLessThan(5.6037);
    expect(g.viewport.high.lng).toBeGreaterThan(-0.187);
  });
});

describe("findPlace", () => {
  it("biases to 1 km around the pin and picks the best name + distance match", async () => {
    const t = setup([json(findFixture)]);
    const center = { lat: 6.1300674, lng: 1.2556815 };
    const p = await t.provider.findPlace({ name: "Hotel Sarakawa", center }, t.ctx);
    expect(p?.name).toBe("Hôtel Sarakawa");
    expect(t.calls[0]!.headers.get("X-Goog-FieldMask")).toBe(FIND_PLACE_FIELD_MASK);
    expect(t.calls[0]!.body).toEqual({
      textQuery: "Hotel Sarakawa",
      pageSize: 5,
      locationBias: { circle: { center: { latitude: 6.1300674, longitude: 1.2556815 }, radius: 1000 } },
    });
    expect(t.usage).toEqual([{ operation: "find_place", requests: 1, costUsd: 0.035, billable: true }]);
  });

  it("works without a center and returns null when nothing credible matches", async () => {
    const t = setup([json(findFixture)]);
    expect((await t.provider.findPlace({ name: "Hôtel Sarakawa" }, t.ctx))?.name).toBe("Hôtel Sarakawa");
    expect(t.calls[0]!.body).toEqual({ textQuery: "Hôtel Sarakawa", pageSize: 5 });
    expect(await t.provider.findPlace({ name: "Pharmacie du Grand Marché", center: { lat: 6.3, lng: 1.0 } }, t.ctx)).toBeNull();
    expect(await t.provider.findPlace({ name: " " }, t.ctx)).toBeNull();
    expect(t.calls).toHaveLength(2);
  });
});

describe("getDetails", () => {
  it("GETs each unique valid id with bounded concurrency and skips removed places", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids = ["ChIJaaa1", "ChIJbbb2", "ChIJccc3", "ChIJddd4", "ChIJeee5", "ChIJgone", "ChIJaaa1", "../../etc/passwd", ""];
    const t = setup([
      async (call) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        const id = decodeURIComponent(call.url.split("/places/")[1]!);
        if (id === "ChIJgone") return json(errors.notFound, 404);
        return json({ ...detailsFixture, id, displayName: { text: `Place ${id}` } });
      },
    ]);
    const out = await t.provider.getDetails(ids, t.ctx);

    expect([...out.keys()]).toEqual(["ChIJaaa1", "ChIJbbb2", "ChIJccc3", "ChIJddd4", "ChIJeee5"]);
    expect(out.get("ChIJccc3")?.name).toBe("Place ChIJccc3");
    expect(t.calls).toHaveLength(6);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
    for (const c of t.calls) {
      expect(c.method).toBe("GET");
      expect(c.url).toMatch(/^https:\/\/places\.googleapis\.com\/v1\/places\/ChIJ\w+$/);
      expect(c.headers.get("X-Goog-FieldMask")).toBe(DETAILS_FIELD_MASK);
      expect(c.headers.get("X-Goog-Api-Key")).toBe(KEY);
      expect(c.body).toBeNull();
    }
    expect(t.usage).toHaveLength(6);
    expect(t.usage.filter((u) => u.billable)).toHaveLength(5);
    expect(t.usage.every((u) => u.operation === "place_details")).toBe(true);
    expect(t.usage.find((u) => u.billable)?.costUsd).toBe(0.02);
  });

  it("returns an empty map for no ids and throws systemic errors", async () => {
    const empty = setup([json(detailsFixture)]);
    expect((await empty.provider.getDetails([], empty.ctx)).size).toBe(0);
    expect(empty.calls).toHaveLength(0);

    const auth = setup([json(errors.serviceDisabled, 403)]);
    expect((await rejection(auth.provider.getDetails(["ChIJaaa1", "ChIJbbb2"], auth.ctx))).kind).toBe("auth");
  });
});

describe("provider basics", () => {
  it("identifies itself and estimates with the configured price", () => {
    const t = setup([]);
    expect(t.provider).toMatchObject({ id: "google_places", isSample: false });
    expect(t.provider.estimate(100)).toMatchObject({ estimatedRequests: 12, maxRequests: 23, estimatedCostUsd: 0.42, freeMonthlyRequests: 1000 });
  });

  it("refuses to start without a key", () => {
    expect(() => createGooglePlacesProvider({ apiKey: "", textSearchPricePer1000: 35, detailsPricePer1000: 20 })).toThrow(ProviderError);
  });
});
