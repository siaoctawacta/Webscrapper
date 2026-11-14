import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, ParsedMapsLinkDto } from "@/lib/api-types";
import { closeDb } from "@/server/db";
import { MAPS_LINK_MESSAGES } from "@/server/maps-link";
import { createTestUser } from "../../../../../../tests/helpers/auth";
import { resetDb } from "../../../../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../../../../tests/helpers/request";
import { POST } from "./route";

const USER_LINK =
  "https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z/data=!3m1!4b1!4m4!2m3!5m2!5m1!1s2026-10-27?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D";
const PLACE_LINK =
  "https://www.google.com/maps/place/Hotel+Sarakawa/@6.1300727,1.2531066,17z/data=!3m1!4b1!4m9!3m8!1s0x1023e1c5f0b0c7f5:0x8c2e6b6f8a0d1e2f!5m2!4m1!1i2!8m2!3d6.1300674!4d1.2556815!16s%2Fg%2F1tf1ylzs";

const parse = (body: unknown, user?: Awaited<ReturnType<typeof createTestUser>>) =>
  POST(apiRequest("/api/v1/maps-links/parse", { method: "POST", body, user }), ctx({}));

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());
afterAll(closeDb);

describe("POST /api/v1/maps-links/parse", () => {
  it("parses the user's search link for a signed-in user", async () => {
    const user = await createTestUser();
    const res = await parse({ url: USER_LINK }, user);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const dto = (await res.json()) as ParsedMapsLinkDto;
    expect(dto).toMatchObject({
      kind: "search",
      query: "hôtel",
      resolvedUrl: USER_LINK,
      location: { label: "Map area near 6.1434, 1.1658 · ≈49 × 30 km", center: { lat: 6.1433903, lng: 1.1657635 } },
    });
    expect(dto.location.viewport?.low.lat).toBeLessThan(6.1433903);
  });

  it("parses a place link", async () => {
    const user = await createTestUser();
    const dto = (await (await parse({ url: `  ${PLACE_LINK}  ` }, user)).json()) as ParsedMapsLinkDto;
    expect(dto).toMatchObject({ kind: "place", name: "Hotel Sarakawa", location: { label: "Hotel Sarakawa", center: { lat: 6.1300674, lng: 1.2556815 } } });
  });

  it("follows short links (network mocked)", async () => {
    const user = await createTestUser();
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: PLACE_LINK } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await parse({ url: "https://maps.app.goo.gl/AbCdEf123XyZ" }, user);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ParsedMapsLinkDto).kind).toBe("place");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when signed out", async () => {
    const res = await parse({ url: USER_LINK });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ApiError).error.code).toBe("unauthorized");
  });

  it("returns 403 for pending accounts", async () => {
    const pending = await createTestUser({ status: "pending" });
    expect((await parse({ url: USER_LINK }, pending)).status).toBe(403);
  });

  it("returns 422 with a friendly message for links it can't use", async () => {
    const user = await createTestUser();
    const cases: [string, string][] = [
      ["https://example.com/maps/search/hotel", MAPS_LINK_MESSAGES.notGoogle],
      ["https://www.google.com/maps", MAPS_LINK_MESSAGES.noSearch],
      ["javascript:alert(1)", MAPS_LINK_MESSAGES.notGoogle],
    ];
    for (const [url, message] of cases) {
      const res = await parse({ url }, user);
      expect(res.status, url).toBe(422);
      expect((await res.json()) as ApiError).toEqual({ error: { code: "validation_failed", message } });
    }
  });

  it("returns 422 for a missing, empty or over-long url", async () => {
    const user = await createTestUser();
    expect((await parse({}, user)).status).toBe(422);
    expect((await parse({ url: "   " }, user)).status).toBe(422);
    expect((await parse({ url: 42 }, user)).status).toBe(422);
    expect((await parse({ url: `https://www.google.com/maps/search/${"a".repeat(4100)}` }, user)).status).toBe(422);
  });

  it("rate-limits each user to 60 parses per minute", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    // Pin the clock inside one fixed window so the test can't straddle a minute boundary.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Math.floor(Date.now() / 60_000) * 60_000 + 1_000));
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) statuses.push((await parse({ url: USER_LINK }, user)).status);
      expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
      expect(statuses[60]).toBe(429);
      expect((await parse({ url: USER_LINK }, other)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
