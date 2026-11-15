import { describe, expect, it } from "vitest";
import { asciiFileName, contentDisposition, exportFileName, placeName, slugify } from "./filename";
import { hashToken, mintDownloadToken, tokenMatches } from "./tokens";

const day = new Date(Date.UTC(2026, 10, 14, 22, 0));

describe("file names", () => {
  it("builds readable names from the search or collection", () => {
    expect(exportFileName(["hotel", "Lomé"], day, "xlsx")).toBe("leads-hotel-lomé-2026-11-14.xlsx");
    expect(exportFileName(["Hôtel", "Lomé"], day, "csv")).toBe("leads-hôtel-lomé-2026-11-14.csv");
    expect(exportFileName([null, "  "], day, "csv")).toBe("leads-2026-11-14.csv");
    expect(slugify("Salons / Coiffure — Accra (Osu)!")).toBe("salons-coiffure-accra-osu");
    expect(slugify("x".repeat(100))).toHaveLength(60);
  });

  it("derives a place from the location", () => {
    expect(placeName({ label: "Lomé, Togo", city: "Lomé" })).toBe("Lomé");
    expect(placeName({ label: "Accra, Ghana" })).toBe("Accra");
    expect(placeName({ label: "Map area around 6.1434, 1.1658" })).toBeNull();
    expect(placeName(null)).toBeNull();
  });

  it("has an ASCII fallback and an RFC 5987 UTF-8 filename", () => {
    expect(asciiFileName("leads-hôtel-lomé-2026-11-14.xlsx")).toBe("leads-hotel-lome-2026-11-14.xlsx");
    expect(asciiFileName("leads-東京-2026-11-14.csv")).toBe("leads-2026-11-14.csv");
    expect(contentDisposition("leads-hôtel-lomé-2026-11-14.xlsx")).toBe(
      "attachment; filename=\"leads-hotel-lome-2026-11-14.xlsx\"; filename*=UTF-8''leads-h%C3%B4tel-lom%C3%A9-2026-11-14.xlsx",
    );
    expect(contentDisposition("a'b(c).csv")).toContain("filename*=UTF-8''a%27b%28c%29.csv");
  });
});

describe("download tokens", () => {
  it("mints random 32-byte base64url tokens stored as SHA-256", () => {
    const a = mintDownloadToken();
    const b = mintDownloadToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches only the right token", () => {
    const { token, hash } = mintDownloadToken();
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches(mintDownloadToken().token, hash)).toBe(false);
    expect(tokenMatches(token, null)).toBe(false);
    expect(tokenMatches(null, hash)).toBe(false);
    expect(tokenMatches("short", hash)).toBe(false);
    expect(tokenMatches(token, "nothex")).toBe(false);
  });
});
