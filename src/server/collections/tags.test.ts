import { describe, expect, it } from "vitest";
import { MAX_TAGS, normalizeTags, TagError } from "./tags";

describe("normalizeTags", () => {
  it("trims, collapses whitespace, drops blanks and keeps the first casing of duplicates", () => {
    expect(normalizeTags(["  Hot   lead ", "", "   ", "hot lead", "HOT LEAD", "Lomé", "lomé", "VIP"])).toEqual(["Hot lead", "Lomé", "VIP"]);
  });

  it("removes control characters", () => {
    expect(normalizeTags(["a\tb\nc", "x\u0000y"])).toEqual(["a b c", "x y"]);
  });

  it("accepts exactly 40 characters and rejects longer tags with a readable message", () => {
    expect(normalizeTags(["a".repeat(40)])).toEqual(["a".repeat(40)]);
    expect(() => normalizeTags(["b".repeat(41)])).toThrow(TagError);
    expect(() => normalizeTags(["b".repeat(41)])).toThrow(/at most 40 characters/);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(normalizeTags(["é".repeat(40)])).toHaveLength(1);
  });

  it("allows 30 distinct tags and rejects 31", () => {
    const thirty = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(normalizeTags([...thirty, "T0", "t1"])).toHaveLength(30);
    expect(() => normalizeTags([...thirty, "t30"])).toThrow(/at most 30 tags/);
  });
});
