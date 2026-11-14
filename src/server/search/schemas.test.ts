import { describe, expect, it } from "vitest";
import { HttpError } from "../errors";
import { clampTarget, effectiveMaxResults, effectiveMonthlyLimit, formatUsd, monthlyLimitMessage } from "./limits";
import { idempotencyKeyFrom, parseCreateSearchInput } from "./schemas";

const fails = (raw: unknown) => {
  try {
    parseCreateSearchInput(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).code).toBe("validation_failed");
    return (e as HttpError).message;
  }
  throw new Error("expected validation to fail");
};

describe("parseCreateSearchInput", () => {
  it("accepts a link, or keyword + location, and defaults enrich to true", () => {
    expect(parseCreateSearchInput({ mapsUrl: " https://www.google.com/maps/search/hotel ", targetCount: 20 })).toMatchObject({
      mapsUrl: "https://www.google.com/maps/search/hotel",
      enrich: true,
    });
    expect(parseCreateSearchInput({ query: "salon", location: "Accra", targetCount: 100, enrich: false })).toMatchObject({ enrich: false });
  });

  it("treats blank strings and null as missing", () => {
    expect(parseCreateSearchInput({ mapsUrl: "https://maps.app.goo.gl/x", query: "  ", location: null, targetCount: 5 })).toMatchObject({
      query: undefined,
      location: undefined,
    });
  });

  it("explains what is missing in plain language", () => {
    expect(fails({ targetCount: 20 })).toMatch(/Paste a Google Maps link, or type what you are looking for/);
    expect(fails({ query: "hotel", targetCount: 20 })).toMatch(/Type where to search/);
    expect(fails({ location: "Lomé", targetCount: 20 })).toMatch(/Type what you are looking for/);
    expect(fails({ query: "hotel", location: "Lomé", targetCount: 0 })).toMatch(/at least 1/);
    expect(fails({ query: "hotel", location: "Lomé", targetCount: 20001 })).toMatch(/at most 20,000/);
    expect(fails({ query: "hotel", location: "Lomé", targetCount: 2.5 })).toMatch(/whole number/);
    expect(fails({ query: "x".repeat(121), location: "Lomé", targetCount: 20 })).toMatch(/under 120/);
    expect(fails({ query: "hotel", location: "L".repeat(161), targetCount: 20 })).toMatch(/under 160/);
    expect(fails({ mapsUrl: "https://x".padEnd(4100, "x"), targetCount: 20 })).toMatch(/too long/);
    expect(fails({ query: "hotel", location: "Lomé", targetCount: 20, provider: "bing" })).toMatch(/Unknown data source/);
    expect(fails({ query: "hotel", location: "Lomé", targetCount: 20, fields: ["nope"] })).toMatch(/Unknown field/);
  });
});

describe("idempotencyKeyFrom", () => {
  it("reads, trims and bounds the header", () => {
    expect(idempotencyKeyFrom(new Headers())).toBeNull();
    expect(idempotencyKeyFrom(new Headers({ "Idempotency-Key": "  abc  " }))).toBe("abc");
    expect(idempotencyKeyFrom(new Headers({ "Idempotency-Key": " " }))).toBeNull();
    expect(() => idempotencyKeyFrom(new Headers({ "Idempotency-Key": "k".repeat(101) }))).toThrow(/at most 100/);
  });
});

describe("limits", () => {
  it("uses the override first, then the server default, within 1..20000", () => {
    expect(effectiveMaxResults(500, 20000)).toBe(500);
    expect(effectiveMaxResults(null, 1000)).toBe(1000);
    expect(effectiveMaxResults(null, 0)).toBe(20000);
    expect(effectiveMaxResults(null, 50000)).toBe(20000);
    expect(effectiveMonthlyLimit(null, 5000)).toBe(5000);
    expect(effectiveMonthlyLimit(0, 5000)).toBe(0);
    expect(effectiveMonthlyLimit(null, 0)).toBe(0);
  });

  it("clamps the target", () => {
    expect(clampTarget(1000, 500)).toEqual({ targetCount: 500, clamped: true });
    expect(clampTarget(100, 500)).toEqual({ targetCount: 100, clamped: false });
  });

  it("formats costs and monthly messages", () => {
    expect(formatUsd(56.14)).toBe("$56.14");
    expect(formatUsd(0)).toBe("$0");
    expect(monthlyLimitMessage({ needed: 164, used: 0, limit: 100 })).toMatch(/needs about 164 Google requests, but only 100 of your 100/);
    expect(monthlyLimitMessage({ needed: 10, used: 100, limit: 100 })).toMatch(/used all 100 Google requests/);
  });
});
