import { describe, expect, it, vi } from "vitest";
import { MAPS_LINK_MESSAGES, MAX_REDIRECT_HOPS, MapsLinkError, resolveMapsLink } from "./index";

const PLACE_URL =
  "https://www.google.com/maps/place/Hotel+Sarakawa/@6.1300727,1.2531066,17z/data=!3m1!4b1!4m9!3m8!1s0x1023e1c5f0b0c7f5:0x8c2e6b6f8a0d1e2f!5m2!4m1!1i2!8m2!3d6.1300674!4d1.2556815!16s%2Fg%2F1tf1ylzs?entry=tts";

type Hop = { status: number; location?: string } | Error;

/** fetch mock that answers each call with the next hop and records what was requested. */
function chain(hops: Hop[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const bodyCancelled: boolean[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const hop = hops[calls.length - 1];
    if (!hop) throw new Error(`unexpected fetch #${calls.length}: ${String(input)}`);
    if (hop instanceof Error) throw hop;
    const body = new ReadableStream({
      cancel() {
        bodyCancelled.push(true);
      },
    });
    return new Response(hop.status >= 300 && hop.status < 400 ? null : body, {
      status: hop.status,
      headers: hop.location ? { location: hop.location } : {},
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls, bodyCancelled };
}

async function expectMapsError(p: Promise<unknown>, message: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MapsLinkError);
  expect((err as Error).message).toBe(message);
}

describe("resolveMapsLink", () => {
  it("returns full links without any network access", async () => {
    const f = chain([]);
    const r = await resolveMapsLink("https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z", { fetch: f.fetch });
    expect(r).toMatchObject({ kind: "search", query: "hôtel", resolvedUrl: "https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z" });
    expect(f.calls).toHaveLength(0);
  });

  it("follows a maps.app.goo.gl redirect with redirect: manual and reads the target", async () => {
    const f = chain([{ status: 302, location: PLACE_URL }]);
    const r = await resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch });
    expect(r).toMatchObject({ kind: "place", name: "Hotel Sarakawa", center: { lat: 6.1300674, lng: 1.2556815 }, resolvedUrl: PLACE_URL });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://maps.app.goo.gl/AbCdEf123XyZ");
    expect(f.calls[0]!.init?.redirect).toBe("manual");
    expect(f.calls[0]!.init?.method).toBe("GET");
  });

  it("follows a multi-hop chain (goo.gl → maps.app.goo.gl → maps.google.com ?q=&ftid=)", async () => {
    const f = chain([
      { status: 301, location: "https://maps.app.goo.gl/AbCdEf123XyZ" },
      { status: 302, location: "https://maps.google.com?q=H%C3%B4tel+Sarakawa,+Boulevard+du+Mono,+Lom%C3%A9&ftid=0x1023e1c5f0b0c7f5:0x8c2e6b6f8a0d1e2f&entry=gps" },
    ]);
    const r = await resolveMapsLink("https://goo.gl/maps/Xyz789", { fetch: f.fetch });
    expect(r).toMatchObject({ kind: "place", name: "Hôtel Sarakawa, Boulevard du Mono, Lomé" });
    expect(f.calls.map((c) => c.url)).toEqual(["https://goo.gl/maps/Xyz789", "https://maps.app.goo.gl/AbCdEf123XyZ"]);
  });

  it("resolves relative Location headers against the current URL", async () => {
    const f = chain([
      { status: 302, location: "/AbCdEf123XyZ2" },
      { status: 302, location: "https://www.google.com/maps/search/hotel/@6.13,1.22,12z" },
    ]);
    const r = await resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch });
    expect(f.calls[1]!.url).toBe("https://maps.app.goo.gl/AbCdEf123XyZ2");
    expect(r.kind).toBe("search");
  });

  it("extracts consent.google.com ?continue= without fetching the consent page", async () => {
    const target = "https://www.google.com/maps/search/pharmacie/@6.1725,1.2314,13z?entry=ttu";
    const f = chain([{ status: 303, location: `https://consent.google.com/ml?continue=${encodeURIComponent(target)}&gl=TG&hl=fr&pc=m&src=1` }]);
    const r = await resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch });
    expect(r).toMatchObject({ kind: "search", query: "pharmacie", zoom: 13, resolvedUrl: target });
    expect(f.calls).toHaveLength(1);
  });

  it("rejects a redirect to a non-Google host and does not follow it", async () => {
    const f = chain([{ status: 302, location: "https://evil.example/phish?u=https://www.google.com/maps" }]);
    await expectMapsError(resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch }), MAPS_LINK_MESSAGES.shortNotGoogle);
    expect(f.calls).toHaveLength(1);
  });

  it("rejects consent pages whose continue target is not Google", async () => {
    const f = chain([{ status: 302, location: "https://consent.google.com/m?continue=https%3A%2F%2Fevil.example%2Fmaps" }]);
    await expectMapsError(resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch }), MAPS_LINK_MESSAGES.consent);
  });

  it("stops after too many hops", async () => {
    const hops: Hop[] = Array.from({ length: MAX_REDIRECT_HOPS + 2 }, (_, i) => ({ status: 302, location: `https://maps.app.goo.gl/loop${i}` }));
    const f = chain(hops);
    await expectMapsError(resolveMapsLink("https://maps.app.goo.gl/start", { fetch: f.fetch }), MAPS_LINK_MESSAGES.tooManyRedirects);
    expect(f.calls).toHaveLength(MAX_REDIRECT_HOPS);
  });

  it("reports an expired/dead short link (no redirect) and never reads the body", async () => {
    const f = chain([{ status: 404 }]);
    await expectMapsError(resolveMapsLink("https://maps.app.goo.gl/gone", { fetch: f.fetch }), MAPS_LINK_MESSAGES.shortDead);
    expect(f.bodyCancelled).toEqual([true]);
  });

  it("follows an unreadable Google URL once more, then reports why it can't be read", async () => {
    const f = chain([
      { status: 302, location: "https://maps.google.com/?cid=10040165390553366062" },
      { status: 200 },
    ]);
    await expectMapsError(resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch }), MAPS_LINK_MESSAGES.placeById);
    expect(f.calls.map((c) => c.url)).toEqual(["https://maps.app.goo.gl/AbCdEf123XyZ", "https://maps.google.com/?cid=10040165390553366062"]);
  });

  it("turns network failures into a friendly error", async () => {
    const f = chain([new TypeError("fetch failed")]);
    await expectMapsError(resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: f.fetch }), MAPS_LINK_MESSAGES.shortUnreachable);
  });

  it("propagates caller aborts instead of masking them", async () => {
    const ac = new AbortController();
    ac.abort(new DOMException("cancelled", "AbortError"));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response(null, { status: 302, headers: { location: PLACE_URL } });
    }) as unknown as typeof fetch;
    await expect(resolveMapsLink("https://maps.app.goo.gl/AbCdEf123XyZ", { fetch: fetchMock, signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still rejects bad input before any network access", async () => {
    const f = chain([]);
    await expectMapsError(resolveMapsLink("javascript:alert(1)", { fetch: f.fetch }), MAPS_LINK_MESSAGES.notGoogle);
    await expectMapsError(resolveMapsLink("https://example.com/maps/search/hotel", { fetch: f.fetch }), MAPS_LINK_MESSAGES.notGoogle);
    expect(f.calls).toHaveLength(0);
  });
});
