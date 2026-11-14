import { describe, expect, it } from "vitest";
import { normalizeWebUrl, senderProfileInputSchema } from "./schema";

describe("senderProfileInputSchema", () => {
  it("trims, turns empty strings into null and keeps absent keys absent", () => {
    const r = senderProfileInputSchema.parse({ senderName: "  Kofi Mensah ", senderCompany: "", signature: null });
    expect(r).toEqual({ senderName: "Kofi Mensah", senderCompany: null, signature: null });
    expect("senderEmail" in r).toBe(false);
  });

  it("validates email, phone and language", () => {
    expect(senderProfileInputSchema.safeParse({ senderEmail: "kofi@studio.com.gh" }).success).toBe(true);
    const bad = senderProfileInputSchema.safeParse({ senderEmail: "kofi@" });
    expect(bad.error?.issues[0]).toMatchObject({ path: ["senderEmail"], message: expect.stringMatching(/valid email/) });
    expect(senderProfileInputSchema.safeParse({ senderPhone: "+228 90 12 34 56" }).success).toBe(true);
    expect(senderProfileInputSchema.safeParse({ senderPhone: "call me" }).success).toBe(false);
    expect(senderProfileInputSchema.safeParse({ defaultLanguage: "fr" }).success).toBe(true);
    expect(senderProfileInputSchema.safeParse({ defaultLanguage: "de" }).success).toBe(false);
  });

  it("allows only http(s) web addresses and adds https:// to bare domains", () => {
    expect(senderProfileInputSchema.parse({ senderWebsite: "monstudio.tg" })).toEqual({ senderWebsite: "https://monstudio.tg" });
    expect(senderProfileInputSchema.parse({ senderPortfolioUrl: "http://behance.net/kofi" })).toEqual({ senderPortfolioUrl: "http://behance.net/kofi" });
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://files.example.com", "mailto:a@b.co", "https://localhost", "https://user:pw@site.com", "not a url"]) {
      expect(senderProfileInputSchema.safeParse({ senderWebsite: bad }).success, bad).toBe(false);
    }
    expect(normalizeWebUrl("site.com:8080/work")).toEqual({ ok: true, url: "https://site.com:8080/work" });
  });

  it("limits lengths (200, signature 1000) and strips control characters", () => {
    expect(senderProfileInputSchema.safeParse({ senderName: "a".repeat(200) }).success).toBe(true);
    expect(senderProfileInputSchema.safeParse({ senderName: "a".repeat(201) }).success).toBe(false);
    expect(senderProfileInputSchema.safeParse({ signature: "a".repeat(1000) }).success).toBe(true);
    expect(senderProfileInputSchema.safeParse({ signature: "a".repeat(1001) }).success).toBe(false);
    expect(senderProfileInputSchema.parse({ signature: "Kofi\r\nStudio\u0000 Ltd\n" })).toEqual({ signature: "Kofi\nStudio Ltd" });
    expect(senderProfileInputSchema.parse({ senderName: "Kofi\nMensah" })).toEqual({ senderName: "Kofi Mensah" });
  });
});
