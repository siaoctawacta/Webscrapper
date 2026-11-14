import { describe, expect, it } from "vitest";
import { isDangerousCellText, sanitizeCellText, stripControlChars } from "./sanitize";

describe("sanitizeCellText", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-2+3", "'-2+3"],
    ["\tfoo", "'foo"],
    ["\r=cmd", "'=cmd"],
    ["=HYPERLINK(\"http://evil.example\",\"click\")", "'=HYPERLINK(\"http://evil.example\",\"click\")"],
    ["  =1+1", "'  =1+1"],
    ["\u0001=1+1", "'=1+1"],
    ["+", "+"],
  ])("neutralises %j", (input, expected) => {
    expect(sanitizeCellText(input)).toBe(expected);
    expect(isDangerousCellText(input)).toBe(expected !== input);
  });

  it.each([
    "Hôtel Le Bénin",
    "Plain text, with commas",
    "+228 90 12 34 56",
    "+1 (555) 010-0000",
    "-5",
    "-12.5",
    "00123",
    "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "contact@hotel.example",
    "https://hotel.example/?q=a=b",
    "a = b",
    "",
  ])("keeps %j unchanged", (input) => {
    expect(isDangerousCellText(input)).toBe(false);
    expect(sanitizeCellText(input)).toBe(input);
  });

  it("strips ASCII control characters but keeps line feeds", () => {
    expect(stripControlChars("line 1\r\nline\u0000 2\u0007\u001b\u007f")).toBe("line 1\nline 2");
    expect(sanitizeCellText("Notes:\nCall back\tMonday")).toBe("Notes:\nCall backMonday");
  });
});
