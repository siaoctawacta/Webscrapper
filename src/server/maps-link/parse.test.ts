import { describe, expect, it } from "vitest";
import {
  MAPS_LINK_MESSAGES,
  MapsLinkError,
  formatAreaSize,
  haversineMeters,
  isGoogleHost,
  metersToZoom,
  parseMapsUrl,
  parseMapsUrlDetailed,
  rectSizeMeters,
  toParsedMapsLinkDto,
  toSearchLocation,
  viewportFromZoom,
  type FullParsedMapsUrl,
  type ParsedMapsUrl,
} from "./parse";

const USER_LINK =
  "https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z/data=!3m1!4b1!4m4!2m3!5m2!5m1!1s2026-10-27?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D";
const PLACE_LINK =
  "https://www.google.com/maps/place/Hotel+Sarakawa/@6.1300727,1.2531066,17z/data=!3m1!4b1!4m9!3m8!1s0x1023e1c5f0b0c7f5:0x8c2e6b6f8a0d1e2f!5m2!4m1!1i2!8m2!3d6.1300674!4d1.2556815!16s%2Fg%2F1tf1ylzs";

function expectKind<K extends ParsedMapsUrl["kind"]>(p: ParsedMapsUrl, kind: K): Extract<ParsedMapsUrl, { kind: K }> {
  expect(p.kind).toBe(kind);
  return p as Extract<ParsedMapsUrl, { kind: K }>;
}

function expectError(input: string, message: string) {
  let err: unknown;
  try {
    parseMapsUrl(input);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(MapsLinkError);
  expect((err as Error).message).toBe(message);
}

describe("parseMapsUrl — search links", () => {
  it("reads the user's hôtel search link (query, center, zoom, ≈49 × 30 km viewport)", () => {
    const p = expectKind(parseMapsUrl(USER_LINK), "search");
    expect(p.query).toBe("hôtel");
    expect(p.center).toEqual({ lat: 6.1433903, lng: 1.1657635 });
    expect(p.zoom).toBe(12);
    const vp = p.viewport!;
    expect(vp.low.lat).toBeLessThan(6.1433903);
    expect(vp.high.lat).toBeGreaterThan(6.1433903);
    expect(vp.low.lng).toBeLessThan(1.1657635);
    expect(vp.high.lng).toBeGreaterThan(1.1657635);
    const size = rectSizeMeters(vp);
    expect(size.width / 1000).toBeGreaterThan(47);
    expect(size.width / 1000).toBeLessThan(50);
    expect(size.height / 1000).toBeGreaterThan(29);
    expect(size.height / 1000).toBeLessThan(31.5);
    // Centered on the link's position.
    expect((vp.low.lng + vp.high.lng) / 2).toBeCloseTo(1.1657635, 6);
    expect((vp.low.lat + vp.high.lat) / 2).toBeCloseTo(6.1433903, 3);
  });

  it("labels the user's link as a map area with its size", () => {
    const loc = toSearchLocation(parseMapsUrl(USER_LINK) as FullParsedMapsUrl);
    expect(loc.label).toBe("Map area near 6.1434, 1.1658 · ≈49 × 30 km");
    expect(loc.center).toEqual({ lat: 6.1433903, lng: 1.1657635 });
    expect(loc.viewport).toBeDefined();
  });

  it.each([
    ["google.fr with ?hl=fr", "https://www.google.fr/maps/search/restaurant/@6.1319,1.2228,14z?hl=fr", "restaurant", 6.1319, 1.2228, 14],
    ["google.tg, encoded accent and +", "https://www.google.tg/maps/search/pharmacie+lom%C3%A9/@6.1725,1.2314,13z", "pharmacie lomé", 6.1725, 1.2314, 13],
    ["google.com.gh (Accra, negative lng)", "https://www.google.com.gh/maps/search/hotels+in+accra/@5.6037,-0.187,12z/data=!3m1!4b1", "hotels in accra", 5.6037, -0.187, 12],
    ["google.co.uk with trailing segments", "https://www.google.co.uk/maps/search/coffee+shop/@51.5072,-0.1276,15z/am=t/data=!3m1!4b1", "coffee shop", 51.5072, -0.1276, 15],
    ["fractional zoom, southern hemisphere", "https://www.google.com/maps/search/hotel/@-33.8688,151.2093,12.5z", "hotel", -33.8688, 151.2093, 12.5],
    ["mobile share params", "https://www.google.com/maps/search/garage/@6.1801,1.1902,16z?entry=tts&g_ep=EgoyMDI2&shorturl=1", "garage", 6.1801, 1.1902, 16],
    ["maps.google.com host", "https://maps.google.com/maps/search/boulangerie/@6.135,1.212,15z", "boulangerie", 6.135, 1.212, 15],
    ["uppercase host and http scheme", "HTTP://WWW.GOOGLE.COM/maps/search/salon+de+coiffure/@6.15,1.25,14z", "salon de coiffure", 6.15, 1.25, 14],
  ])("%s", (_label, url, query, lat, lng, zoom) => {
    const p = expectKind(parseMapsUrl(url), "search");
    expect(p.query).toBe(query);
    expect(p.center).toEqual({ lat, lng });
    expect(p.zoom).toBe(zoom);
    expect(p.viewport).not.toBeNull();
  });

  it("keeps encoded '+', '&' and '/' inside the query", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/caf%C3%A9+%26+bar+C%2B%2B+24%2F7/@6.13,1.22,14z"), "search");
    expect(p.query).toBe("café & bar C++ 24/7");
  });

  it("reads a search with no map position (center/viewport null)", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/hotel+near+Lom%C3%A9"), "search");
    expect(p).toEqual({ kind: "search", query: "hotel near Lomé", center: null, zoom: null, viewport: null });
    expect(toSearchLocation(p)).toEqual({ label: "No map area in the link" });
  });

  it("reads Maps URLs API links (?api=1&query=)", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/?api=1&query=hotel%20lome"), "search");
    expect(p.query).toBe("hotel lome");
    expect(p.center).toBeNull();
  });

  it("reads ?q= links on maps.google.* and legacy ll/z params", () => {
    expect(expectKind(parseMapsUrl("https://maps.google.com/?q=hotel+accra"), "search").query).toBe("hotel accra");
    expect(expectKind(parseMapsUrl("https://maps.google.fr/maps?q=pharmacie&hl=fr"), "search").query).toBe("pharmacie");
    const legacy = expectKind(parseMapsUrl("https://www.google.com/maps?q=restaurant&ll=6.13,1.22&z=13"), "search");
    expect(legacy.center).toEqual({ lat: 6.13, lng: 1.22 });
    expect(legacy.zoom).toBe(13);
    expect(legacy.viewport).not.toBeNull();
  });

  it("accepts links pasted without https:// and inside shared text", () => {
    expect(expectKind(parseMapsUrl("www.google.com/maps/search/hotel/@6.13,1.22,12z"), "search").query).toBe("hotel");
    const shared = "Look at these:\nhttps://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z  thanks";
    expect(expectKind(parseMapsUrl(shared), "search").query).toBe("hôtel");
    expect(expectKind(parseMapsUrl("  <https://www.google.com/maps/search/hotel>  "), "search").query).toBe("hotel");
  });

  it("treats a coordinates-only search as a map view", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/?api=1&query=6.1319,1.2228"), "map_view");
    expect(p.center).toEqual({ lat: 6.1319, lng: 1.2228 });
    const path = expectKind(parseMapsUrl("https://www.google.com/maps/search/6.1319,+1.2228/@6.1319,1.2228,17z"), "map_view");
    expect(path.zoom).toBe(17);
  });

  it("survives malformed percent-encoding", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/h%C3%B4tel+%E0%A4/@6.13,1.22,12z"), "search");
    expect(p.query).toBe("hôtel %E0%A4");
  });
});

describe("parseMapsUrl — place links", () => {
  it("reads the Hotel Sarakawa place link and prefers the !3d!4d pin", () => {
    const p = expectKind(parseMapsUrl(PLACE_LINK), "place");
    expect(p.name).toBe("Hotel Sarakawa");
    expect(p.center).toEqual({ lat: 6.1300674, lng: 1.2556815 });
    expect(p.zoom).toBe(17);
    expect(p.viewport).not.toBeNull();
    const loc = toSearchLocation(p);
    expect(loc.label).toBe("Hotel Sarakawa");
    expect(loc.center).toEqual({ lat: 6.1300674, lng: 1.2556815 });
  });

  it("falls back to the @ position when there is no pin", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/place/H%C3%B4tel+2+F%C3%A9vrier/@6.1371,1.2125,15z"), "place");
    expect(p.name).toBe("Hôtel 2 Février");
    expect(p.center).toEqual({ lat: 6.1371, lng: 1.2125 });
  });

  it("reads place links on other Google domains", () => {
    const p = expectKind(
      parseMapsUrl("https://www.google.co.uk/maps/place/Big+Ben/@51.5007,-0.1246,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5007292!4d-0.1246254!16zL20vMGN0MXQ"),
      "place",
    );
    expect(p.name).toBe("Big Ben");
    expect(p.center).toEqual({ lat: 51.5007292, lng: -0.1246254 });
  });

  it("reads a place with no coordinates at all", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/place/Hotel+Sarakawa/data=!4m2!3m1!1s0x1023e1c5f0b0c7f5:0x8c2e6b6f8a0d1e2f"), "place");
    expect(p).toEqual({ kind: "place", name: "Hotel Sarakawa", center: null, zoom: null, viewport: null });
    expect(toSearchLocation(p)).toEqual({ label: "Hotel Sarakawa" });
  });

  it("reads mobile share redirects (?q=Name, address&ftid=…) as a place", () => {
    const p = expectKind(
      parseMapsUrl("https://maps.google.com?q=H%C3%B4tel+Sarakawa,+Boulevard+du+Mono,+Lom%C3%A9&ftid=0x1023e1c5f0b0c7f5:0x8c2e6b6f8a0d1e2f&entry=gps&g_st=ic"),
      "place",
    );
    expect(p.name).toBe("Hôtel Sarakawa, Boulevard du Mono, Lomé");
  });

  it("reads api=1 place links with query_place_id", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/?api=1&query=Hotel%20Sarakawa&query_place_id=ChIJPTacEpBQwjsRbkaxl5dXaM4"), "place");
    expect(p.name).toBe("Hotel Sarakawa");
  });

  it("turns a dropped pin (DMS name) into a map view", () => {
    const p = expectKind(
      parseMapsUrl("https://www.google.com/maps/place/6%C2%B007'54.0%22N+1%C2%B013'22.1%22E/@6.1316667,1.2228056,17z/data=!3m1!4b1!4m4!3m3!8m2!3d6.1316667!4d1.2228056"),
      "map_view",
    );
    expect(p.center).toEqual({ lat: 6.1316667, lng: 1.2228056 });
    expect(p.zoom).toBe(17);
  });
});

describe("parseMapsUrl — map views", () => {
  it("reads /maps/@lat,lng,zoom", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/@6.1319,1.2228,14z"), "map_view");
    expect(p).toMatchObject({ center: { lat: 6.1319, lng: 1.2228 }, zoom: 14 });
    expect(toSearchLocation(p).label).toBe("Map area near 6.1319, 1.2228 · ≈12 × 7.6 km");
  });

  it("converts satellite meters altitude to an approximate zoom", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/@6.1319,1.2228,3214m/data=!3m1!1e3"), "map_view");
    expect(p.zoom).toBeGreaterThan(15);
    expect(p.zoom).toBeLessThan(15.5);
    expect(rectSizeMeters(p.viewport!).height).toBeGreaterThan(2800);
    expect(rectSizeMeters(p.viewport!).height).toBeLessThan(3600);
  });

  it("reads Street View links (no zoom) and gives them a default area", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/@6.1319,1.2228,3a,75y,90h,90t/data=!3m6!1e1"), "map_view");
    expect(p.zoom).toBeNull();
    expect(p.viewport).toBeNull();
    expect(toSearchLocation(p).viewport).toBeDefined();
  });

  it("reads api=1 map_action=map links and legacy ll links", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/@?api=1&map_action=map&center=6.13,1.22&zoom=12&basemap=satellite"), "map_view");
    expect(p).toMatchObject({ center: { lat: 6.13, lng: 1.22 }, zoom: 12 });
    expect(expectKind(parseMapsUrl("https://maps.google.com/maps?ll=6.13,1.22&z=12&t=k"), "map_view").zoom).toBe(12);
  });
});

describe("parseMapsUrl — short links and wrappers", () => {
  it.each([
    "https://maps.app.goo.gl/AbCdEf123XyZ",
    "https://maps.app.goo.gl/AbCdEf123XyZ?g_st=iw",
    "https://goo.gl/maps/AbCdEf123",
    "maps.app.goo.gl/AbCdEf123XyZ",
  ])("%s → short", (url) => {
    const p = expectKind(parseMapsUrl(url), "short");
    expect(p.url.startsWith("https://")).toBe(true);
  });

  it("unwraps consent.google.com ?continue= and google.com/url?q=", () => {
    const consent =
      "https://consent.google.com/m?continue=https://www.google.com/maps/search/hotel/@6.13,1.22,12z?entry%3Dttu&gl=TG&m=0&pc=m&uxe=eomtm&cm=2&hl=fr&src=1";
    const d = parseMapsUrlDetailed(consent);
    expect(d.parsed).toMatchObject({ kind: "search", query: "hotel" });
    expect(d.url.startsWith("https://www.google.com/maps/search/hotel/")).toBe(true);
    const wrapped = "https://www.google.com/url?q=https://www.google.fr/maps/search/pharmacie/@6.13,1.22,14z&sa=D";
    expect(parseMapsUrl(wrapped)).toMatchObject({ kind: "search", query: "pharmacie" });
  });
});

describe("parseMapsUrl — rejects", () => {
  it.each([
    ["empty", "   ", MAPS_LINK_MESSAGES.empty],
    ["javascript:", "javascript:alert(document.cookie)", MAPS_LINK_MESSAGES.notGoogle],
    ["javascript:// trick", "javascript://www.google.com/maps/%0aalert(1)", MAPS_LINK_MESSAGES.notGoogle],
    ["data:", "data:text/html,<script>alert(1)</script>", MAPS_LINK_MESSAGES.notGoogle],
    ["ftp", "ftp://www.google.com/maps/search/hotel", MAPS_LINK_MESSAGES.notGoogle],
    ["other host", "https://example.com/maps/search/hotel/@6.13,1.22,12z", MAPS_LINK_MESSAGES.notGoogle],
    ["lookalike host", "https://google.com.evil.io/maps/search/hotel", MAPS_LINK_MESSAGES.notGoogle],
    ["lookalike prefix", "https://notgoogle.com/maps/search/hotel", MAPS_LINK_MESSAGES.notGoogle],
    ["credentials trick", "https://www.google.com@evil.example/maps/search/hotel", MAPS_LINK_MESSAGES.notGoogle],
    ["odd port", "https://www.google.com:8443/maps/search/hotel", MAPS_LINK_MESSAGES.notGoogle],
    ["plain text", "hotels in lome", MAPS_LINK_MESSAGES.notGoogle],
    ["goo.gl non-maps", "https://goo.gl/AbCdEf", MAPS_LINK_MESSAGES.notGoogle],
    ["Google Search", "https://www.google.com/search?q=hotel+lome&tbm=lcl", MAPS_LINK_MESSAGES.googleSearch],
    ["bare map", "https://www.google.com/maps", MAPS_LINK_MESSAGES.noSearch],
    ["bare maps.google.com", "https://maps.google.com/", MAPS_LINK_MESSAGES.noSearch],
    ["empty search", "https://www.google.com/maps/search/", MAPS_LINK_MESSAGES.noSearch],
    ["directions", "https://www.google.com/maps/dir/Lom%C3%A9/Accra/@6.0,0.5,9z", MAPS_LINK_MESSAGES.directions],
    ["My Maps", "https://www.google.com/maps/d/viewer?mid=1AbC", MAPS_LINK_MESSAGES.myMaps],
    ["cid link", "https://maps.google.com/?cid=10040165390553366062", MAPS_LINK_MESSAGES.placeById],
    ["consent without continue", "https://consent.google.com/m?gl=TG", MAPS_LINK_MESSAGES.consent],
    ["consent to elsewhere", "https://consent.google.com/m?continue=https://evil.example/maps", MAPS_LINK_MESSAGES.consent],
    ["unknown maps path", "https://www.google.com/maps/contrib/1234567890", MAPS_LINK_MESSAGES.unsupported],
  ])("%s", (_label, input, message) => expectError(input, message));

  it("rejects over-long input", () => {
    expectError(`https://www.google.com/maps/search/${"a".repeat(4100)}`, MAPS_LINK_MESSAGES.tooLong);
  });

  it("ignores out-of-range coordinates instead of trusting them", () => {
    const p = expectKind(parseMapsUrl("https://www.google.com/maps/search/hotel/@95.0,200.0,12z"), "search");
    expect(p.center).toBeNull();
  });
});

describe("geometry helpers", () => {
  it("recognises Google hosts", () => {
    for (const h of ["google.com", "www.google.com", "maps.google.com", "google.fr", "www.google.tg", "www.google.com.gh", "www.google.co.uk", "consent.google.com", "GOOGLE.COM."]) {
      expect(isGoogleHost(h), h).toBe(true);
    }
    for (const h of ["google.evil.com", "evilgoogle.com", "google.com.evil.io", "googl.com", "goo.gl"]) {
      expect(isGoogleHost(h), h).toBe(false);
    }
  });

  it("viewportFromZoom follows meters/px = 156543.03392·cos(lat)/2^zoom over 1280×800 px", () => {
    const center = { lat: 0, lng: 0 };
    const vp = viewportFromZoom(center, 10);
    const size = rectSizeMeters(vp);
    const mpp = 156543.03392 / 2 ** 10;
    // Within 0.5% (we measure with the mean Earth radius; the formula uses the equatorial one).
    expect(Math.abs(size.width / (mpp * 1280) - 1)).toBeLessThan(0.005);
    expect(Math.abs(size.height / (mpp * 800) - 1)).toBeLessThan(0.005);
    const custom = rectSizeMeters(viewportFromZoom(center, 10, { width: 640, height: 400 }));
    expect(Math.abs(custom.width / (mpp * 640) - 1)).toBeLessThan(0.005);
    const lome = rectSizeMeters(viewportFromZoom({ lat: 6.13, lng: 1.22 }, 15));
    const mppLome = (156543.03392 * Math.cos((6.13 * Math.PI) / 180)) / 2 ** 15;
    expect(Math.abs(lome.width / (mppLome * 1280) - 1)).toBeLessThan(0.005);
  });

  it("viewportFromZoom clamps to the world at low zoom", () => {
    const vp = viewportFromZoom({ lat: 10, lng: 170 }, 1);
    expect(vp.low.lng).toBeGreaterThanOrEqual(-180);
    expect(vp.high.lng).toBeLessThanOrEqual(180);
    expect(vp.high.lat).toBeLessThanOrEqual(85.06);
  });

  it("formats area sizes", () => {
    expect(formatAreaSize(viewportFromZoom({ lat: 6.13, lng: 1.22 }, 18))).toMatch(/^≈\d+ × \d+ m$/);
    expect(formatAreaSize(viewportFromZoom({ lat: 6.13, lng: 1.22 }, 12))).toBe("≈49 × 30 km");
  });

  it("metersToZoom and haversine are sane", () => {
    expect(metersToZoom(30_000, 6.13)).toBeCloseTo(12, 0);
    expect(haversineMeters({ lat: 6.1375, lng: 1.2123 }, { lat: 5.6037, lng: -0.187 }) / 1000).toBeCloseTo(166, -1);
  });

  it("builds the API DTO", () => {
    const dto = toParsedMapsLinkDto({ ...(parseMapsUrl(PLACE_LINK) as FullParsedMapsUrl), resolvedUrl: PLACE_LINK });
    expect(dto).toMatchObject({ kind: "place", name: "Hotel Sarakawa", resolvedUrl: PLACE_LINK, location: { label: "Hotel Sarakawa" } });
  });
});
