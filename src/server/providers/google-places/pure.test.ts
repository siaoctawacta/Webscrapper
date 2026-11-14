import { describe, expect, it } from "vitest";
import type { ProviderPlace } from "../types";
import page1 from "./__fixtures__/text-search-lome-hotels-page1.json";
import details from "./__fixtures__/place-details-lagon-bleu.json";
import { estimateGoogleTextSearch } from "./estimate";
import { boxAround, normalizeArea, rectContains, rectSizeMeters, splitRect } from "./geo";
import { DETAILS_FIELD_MASK, TEXT_SEARCH_FIELD_MASK, addressParts, mapPlace, mapPlaces, readNextPageToken } from "./mapping";
import { nameSimilarity, pickBestMatch } from "./match";

describe("field masks", () => {
  it("match the documented Text Search and Details masks exactly", () => {
    expect(TEXT_SEARCH_FIELD_MASK).toBe(
      "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location,places.primaryType,places.primaryTypeDisplayName,places.types,places.businessStatus,nextPageToken",
    );
    expect(DETAILS_FIELD_MASK).toBe(
      "id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,googleMapsUri,location,primaryType,primaryTypeDisplayName,types,businessStatus",
    );
  });
});

describe("mapPlace", () => {
  it("maps a full Place Details fixture", () => {
    const p = mapPlace(details)!;
    expect(p).toEqual<ProviderPlace>({
      sourceRecordId: details.id,
      name: "Hôtel Le Lagon Bleu",
      category: "Hotel",
      categories: ["hotel", "lodging", "point_of_interest", "establishment"],
      phoneNational: details.nationalPhoneNumber!,
      phoneInternational: details.internationalPhoneNumber!,
      websiteUrl: "https://www.hotel-le-lagon-bleu.example/",
      email: null,
      address: details.formattedAddress,
      city: "Lomé",
      region: "Région Maritime",
      country: "Togo",
      countryCode: "TG",
      postalCode: null,
      lat: details.location.latitude,
      lng: details.location.longitude,
      rating: details.rating!,
      reviewCount: details.userRatingCount!,
      mapsUrl: details.googleMapsUri,
      businessStatus: "OPERATIONAL",
    });
    expect(p.phoneInternational?.startsWith("+228 ")).toBe(true);
  });

  it("keeps missing website / phone / rating as null (never invented)", () => {
    const places = mapPlaces(page1);
    expect(places).toHaveLength(20);
    const noWeb = places.filter((p) => p.websiteUrl === null);
    const noPhone = places.filter((p) => p.phoneNational === null && p.phoneInternational === null);
    expect(noWeb.length).toBeGreaterThan(5);
    expect(noPhone.length).toBeGreaterThan(0);
    const noRating = places.find((p) => p.name === "Hôtel Bè Kpota")!;
    expect(noRating.rating).toBeNull();
    expect(noRating.reviewCount).toBeNull();
    expect(places.every((p) => p.email === null)).toBe(true);
    expect(places.find((p) => p.businessStatus === "CLOSED_TEMPORARILY")).toBeDefined();
    expect(readNextPageToken(page1)).toBe(page1.nextPageToken);
  });

  it("uses primaryTypeDisplayName, falling back to a readable primaryType", () => {
    const guest = mapPlaces(page1).find((p) => p.name === "Guest House Kodjoviakopé")!;
    expect(guest.category).toBe("Guest house");
    expect(mapPlace({ id: "x1", primaryType: "resort_hotel", primaryTypeDisplayName: { text: "Resort hotel" } })!.category).toBe("Resort hotel");
    expect(mapPlace({ id: "x2" })!.category).toBeNull();
  });

  it("puts the primary type first in categories when Google lists it elsewhere", () => {
    expect(mapPlace({ id: "x3", primaryType: "guest_house", types: ["lodging", "point_of_interest"] })!.categories).toEqual([
      "guest_house",
      "lodging",
      "point_of_interest",
    ]);
  });

  it("drops malformed values instead of trusting them", () => {
    expect(mapPlace(null)).toBeNull();
    expect(mapPlace({ displayName: { text: "No id" } })).toBeNull();
    const p = mapPlace({
      id: "x4",
      displayName: { text: "  Hôtel\u0007 Test  " },
      websiteUri: "javascript:alert(1)",
      googleMapsUri: "not a url",
      rating: 9,
      userRatingCount: -3,
      location: { latitude: 200, longitude: 1 },
      types: ["hotel", 42, null],
    })!;
    expect(p).toMatchObject({ name: "Hôtel Test", websiteUrl: null, mapsUrl: null, rating: null, reviewCount: null, lat: null, lng: null, categories: ["hotel"] });
    expect(mapPlaces({ places: [{ id: "ok" }, "junk", { nope: true }] }).map((x) => x.sourceRecordId)).toEqual(["ok"]);
    expect(mapPlaces({})).toEqual([]);
  });

  it("maps postal codes, postal towns and country codes", () => {
    expect(
      addressParts([
        { longText: "London", types: ["postal_town"] },
        { longText: "England", types: ["administrative_area_level_1", "political"] },
        { longText: "United Kingdom", shortText: "GB", types: ["country", "political"] },
        { longText: "SW1A 0AA", types: ["postal_code"] },
      ]),
    ).toEqual({ city: "London", region: "England", country: "United Kingdom", countryCode: "GB", postalCode: "SW1A 0AA" });
    expect(addressParts(undefined)).toEqual({ city: null, region: null, country: null, countryCode: null, postalCode: null });
  });
});

describe("estimateGoogleTextSearch (§4.2 formula)", () => {
  it.each([
    // target, estimatedRequests, maxRequests, cost at $35/1000
    [20, 1, 7, 0.035],
    [40, 2, 8, 0.07],
    [60, 3, 10, 0.105],
    [100, 12, 23, 0.42],
    [500, 44, 71, 1.54],
    [1000, 84, 131, 2.94],
    [5000, 404, 611, 14.14],
    [20000, 1604, 2411, 56.14],
  ])("target %i → %i requests, max %i, $%f", (target, est, max, cost) => {
    const e = estimateGoogleTextSearch(target, 35);
    expect(e.estimatedRequests).toBe(est);
    expect(e.maxRequests).toBe(max);
    expect(e.estimatedCostUsd).toBeCloseTo(cost, 6);
    expect(e.freeMonthlyRequests).toBe(1000);
    expect(e.notes.join(" ")).toMatch(/free Text Search \(Enterprise\) requests per month/);
    expect(e.notes.join(" ")).toMatch(/your own Google Cloud account/);
  });

  it("handles silly inputs", () => {
    expect(estimateGoogleTextSearch(0, 35).estimatedRequests).toBe(1);
    expect(estimateGoogleTextSearch(Number.NaN, 35).estimatedRequests).toBe(1);
    expect(estimateGoogleTextSearch(20, -1).estimatedCostUsd).toBe(0);
  });
});

describe("geo", () => {
  const lome = { low: { lat: 6.0, lng: 1.0 }, high: { lat: 6.3, lng: 1.4 } };

  it("splits into four quadrants that cover the parent", () => {
    const [sw, se, nw, ne] = splitRect(lome);
    expect(sw).toEqual({ low: { lat: 6.0, lng: 1.0 }, high: { lat: 6.15, lng: 1.2 } });
    expect(ne.low).toEqual({ lat: 6.15, lng: 1.2 });
    expect(ne.high).toEqual(lome.high);
    expect(se.low.lng).toBeCloseTo(1.2);
    expect(nw.low.lat).toBeCloseTo(6.15);
  });

  it("handles rectangles crossing the 180° meridian", () => {
    const r = { low: { lat: -18, lng: 178 }, high: { lat: -16, lng: -178 } };
    const [sw, se] = splitRect(r);
    expect(sw.high.lng).toBe(180);
    expect(se.low.lng).toBe(180);
    expect(rectContains(r, -17, 179.5)).toBe(true);
    expect(rectContains(r, -17, -179)).toBe(true);
    expect(rectContains(r, -17, 0)).toBe(false);
    expect(rectSizeMeters(r).width / 1000).toBeGreaterThan(400);
  });

  it("normalizes degenerate areas to a minimum box", () => {
    const point = { low: { lat: 6.13, lng: 1.22 }, high: { lat: 6.13, lng: 1.22 } };
    const r = normalizeArea(point, { lat: 6.13, lng: 1.22 }, 600);
    const size = rectSizeMeters(r);
    expect(size.width).toBeGreaterThan(550);
    expect(size.height).toBeGreaterThan(550);
    const swapped = normalizeArea({ low: lome.high, high: lome.low }, { lat: 6.1, lng: 1.2 }, 600);
    expect(swapped.low.lat).toBe(6.0);
    expect(rectSizeMeters(boxAround({ lat: 0, lng: 0 }, 1000)).width).toBeCloseTo(1000, -1);
  });
});

describe("name matching", () => {
  it("scores accents, case, word order and containment", () => {
    expect(nameSimilarity("Hotel Sarakawa", "Hôtel SARAKAWA")).toBe(1);
    expect(nameSimilarity("Sarakawa Hotel", "Hôtel Sarakawa")).toBe(0.95);
    expect(nameSimilarity("Sarakawa", "Hôtel Sarakawa")).toBe(0.85);
    expect(nameSimilarity("Hotel Sarakawa", "Pharmacie du Port")).toBeLessThan(0.3);
  });

  it("prefers the closer of two similar names and refuses unrelated ones", () => {
    const mk = (name: string, lat: number, lng: number): ProviderPlace => ({ ...mapPlace({ id: name.replace(/\W/g, "") })!, name, lat, lng });
    const near = mk("Hôtel Sarakawa", 6.13007, 1.25568);
    const far = mk("Hotel Sarakawa", 6.2, 1.1);
    expect(pickBestMatch("Hotel Sarakawa", { lat: 6.1300674, lng: 1.2556815 }, [far, near])).toBe(near);
    expect(pickBestMatch("Hotel Sarakawa, Boulevard du Mono, Lomé", undefined, [mk("Bar X", 6, 1), near])).toBe(near);
    expect(pickBestMatch("Pharmacie du Port", { lat: 6.0, lng: 1.0 }, [near, far])).toBeNull();
    // Right at the pin, even with a different spelling.
    expect(pickBestMatch("Sarakawa Htl", { lat: 6.1300674, lng: 1.2556815 }, [near])).toBe(near);
  });
});
