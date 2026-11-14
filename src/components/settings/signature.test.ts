import { describe, expect, it } from "vitest";
import { composeSignatureLines, displayUrl, signatureLines } from "./signature";

const base = {
  senderName: "Kofi Mensah",
  senderCompany: "Akwaaba Studio",
  senderEmail: "kofi@akwaaba.example",
  senderPhone: "+233 24 123 4567",
  senderWebsite: "https://www.akwaaba.example/",
  senderPortfolioUrl: "https://dribbble.com/kofi/",
  signature: null,
};

describe("signature preview", () => {
  it("composes lines from the details, skipping blanks", () => {
    expect(composeSignatureLines(base)).toEqual([
      "Kofi Mensah",
      "Akwaaba Studio",
      "+233 24 123 4567 · kofi@akwaaba.example",
      "akwaaba.example",
      "Portfolio: dribbble.com/kofi",
    ]);
    expect(composeSignatureLines({ ...base, senderCompany: null, senderPhone: "", senderPortfolioUrl: null })).toEqual([
      "Kofi Mensah",
      "kofi@akwaaba.example",
      "akwaaba.example",
    ]);
  });

  it("prefers the saved signature", () => {
    expect(signatureLines({ ...base, signature: "  Kofi\nAkwaaba  " })).toEqual({ lines: ["Kofi", "Akwaaba"], source: "signature" });
    expect(signatureLines({ ...base, signature: " " }).source).toBe("details");
    const empty = { senderName: null, senderCompany: null, senderEmail: null, senderPhone: null, senderWebsite: null, senderPortfolioUrl: null, signature: null };
    expect(signatureLines(empty)).toEqual({ lines: [], source: "none" });
  });

  it("shortens URLs for display", () => {
    expect(displayUrl("https://www.studio.tg/")).toBe("studio.tg");
    expect(displayUrl("http://behance.net/ama/work/")).toBe("behance.net/ama/work");
    expect(displayUrl(null)).toBeNull();
  });
});
