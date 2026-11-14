import { describe, expect, it } from "vitest";
import { buildCsv, csvField, CSV_BOM } from "./csv";

describe("buildCsv", () => {
  it("writes a UTF-8 BOM, CRLF line endings and a header row", () => {
    const buf = buildCsv(["Business name", "Rating"], [["Hôtel Le Bénin", 4.5]]);
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString("utf8");
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.slice(1)).toBe("Business name,Rating\r\nHôtel Le Bénin,4.5\r\n");
  });

  it("quotes commas, quotes and newlines per RFC 4180", () => {
    const text = buildCsv(["Name", "Notes"], [["Chez Ama, Lomé", 'She said "call me"\nafter 5pm']]).toString("utf8").slice(1);
    expect(text).toBe('Name,Notes\r\n"Chez Ama, Lomé","She said ""call me""\nafter 5pm"\r\n');
  });

  it("keeps Unicode names, leading zeros and phone plus signs as text", () => {
    const text = buildCsv(
      ["Name", "Postal code", "Phone", "Provider ID"],
      [["Maquis Côte d’Ivoire 🌴 — Ñandú", "00123", "+228 90 12 34 56", "ChIJ00123"]],
    )
      .toString("utf8")
      .slice(1);
    expect(text.split("\r\n")[1]).toBe("Maquis Côte d’Ivoire 🌴 — Ñandú,00123,+228 90 12 34 56,ChIJ00123");
  });

  it("neutralises formulas, writes dates as ISO 8601 UTC and empties nulls", () => {
    const d = new Date(Date.UTC(2026, 10, 14, 9, 30));
    const text = buildCsv(["A", "B", "C", "D"], [["=1+1", "@SUM(A1)", d, null]]).toString("utf8").slice(1);
    expect(text.split("\r\n")[1]).toBe("'=1+1,'@SUM(A1),2026-11-14T09:30:00.000Z,");
  });

  it("quotes values with leading or trailing spaces so they survive import", () => {
    expect(csvField(" padded ")).toBe('" padded "');
    expect(csvField(3)).toBe("3");
    expect(csvField(null)).toBe("");
  });
});
