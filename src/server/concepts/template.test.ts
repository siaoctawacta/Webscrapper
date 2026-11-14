import { describe, expect, it } from "vitest";
import { STYLE_PALETTES, STYLE_TYPOGRAPHY, contrastRatio, isUsablePalette } from "./design";
import { renderConceptHtml } from "./render";
import { CONCEPT_SECTIONS, CONCEPT_STYLES, CONCEPT_TONES, conceptContentSchema, conceptInputSchema, type ConceptOptions } from "./schema";
import { buildTemplateContent, clampText, inSentence, joinList } from "./template";

const base = (over: Partial<ConceptOptions> = {}): ConceptOptions => ({
  services: ["Rooms", "Restaurant", "Airport pick-up", "Event hall"],
  style: "modern",
  tone: "professional",
  language: "en",
  contact: { businessName: "Golden Palm Lodge", phone: "+233 24 123 4567", city: "Accra" },
  ...over,
});

const allText = (c: ReturnType<typeof buildTemplateContent>) =>
  [
    c.siteTitle,
    c.tagline,
    c.hero.headline,
    c.hero.subheadline,
    c.hero.primaryCta,
    c.hero.secondaryCta ?? "",
    c.about.heading,
    c.about.body,
    ...c.services.flatMap((s) => [s.title, s.description]),
    ...c.highlights.flatMap((h) => [h.title, h.description]),
    c.testimonialsNote,
    ...c.gallery.ideas,
    c.contact.heading,
    c.contact.body,
    c.seo.title,
    c.seo.metaDescription,
  ].join("\n");

describe("style palettes", () => {
  it.each(CONCEPT_STYLES)("%s passes text contrast ≥ 4.5:1 on background and surface", (style) => {
    const p = STYLE_PALETTES[style];
    expect(isUsablePalette(p)).toBe(true);
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});

describe("buildTemplateContent", () => {
  for (const language of ["en", "fr"] as const) {
    for (const style of CONCEPT_STYLES) {
      for (const tone of CONCEPT_TONES) {
        it(`${language} · ${style} · ${tone} → valid, deterministic, no invented numbers`, () => {
          const input = base({ language, style, tone });
          const a = buildTemplateContent(input);
          expect(conceptContentSchema.safeParse(a).success).toBe(true);
          expect(buildTemplateContent(input)).toEqual(a);
          expect(a.palette).toEqual(STYLE_PALETTES[style]);
          expect(a.typography.pairing).toBe(STYLE_TYPOGRAPHY[style]);
          expect(a.siteTitle).toBe("Golden Palm Lodge");
          expect(a.services.map((s) => s.title)).toEqual(["Rooms", "Restaurant", "Airport pick-up", "Event hall"]);
          expect(a.sections).toEqual([...CONCEPT_SECTIONS]);
          // Digits only from the input (the phone number); none invented.
          const digits = allText(a).match(/\d+/g) ?? [];
          expect(digits).toEqual([]);
          expect(a.seo.title.length).toBeLessThanOrEqual(60);
          expect(a.seo.metaDescription.length).toBeLessThanOrEqual(160);
          // WhatsApp missing, phone present → the CTA invites a call.
          expect(a.hero.primaryCta).toBe(language === "en" ? "Call us" : "Nous appeler");
          // Renders without throwing.
          expect(renderConceptHtml(a, input.contact, { language })).toContain("Golden Palm Lodge");
        });
      }
    }
  }

  it("writes French copy in French", () => {
    const fr = buildTemplateContent(base({ language: "fr", tone: "friendly" }));
    expect(fr.hero.headline).toBe("Bienvenue chez Golden Palm Lodge");
    expect(fr.about.heading).toBe("À propos de Golden Palm Lodge");
    expect(fr.about.body).toContain("Chez Golden Palm Lodge, nous proposons rooms, restaurant, airport pick-up et event hall à Accra.");
    expect(fr.contact.heading).toBe("Contactez-nous");
    expect(fr.testimonialsNote).toMatch(/avis de vrais clients/);
    expect(fr.hero.secondaryCta).toBe("Voir nos services");
  });

  it("uses the business type, city and contact channels it was given", () => {
    const c = buildTemplateContent(
      base({
        businessType: "Boutique hotel",
        contact: { businessName: "Golden Palm Lodge", whatsapp: "+233241234567", email: "hello@palm.example", address: "Oxford Street", city: "Accra" },
      }),
    );
    expect(c.hero.headline).toBe("Boutique hotel in Accra");
    expect(c.hero.primaryCta).toBe("Message us on WhatsApp");
    expect(c.contact.body).toBe("Send us a WhatsApp message, email us or visit us. We'll be happy to help.");
    expect(c.seo.title).toBe("Golden Palm Lodge — Boutique hotel in Accra");
  });

  it("never writes testimonials — only a placeholder note", () => {
    const c = buildTemplateContent(base());
    expect(c.testimonialsNote).toMatch(/real customers/);
    expect(c.testimonialsNote).toMatch(/Never publish invented testimonials/);
  });

  it("applies the user's primary colour and section choice (in their order)", () => {
    const c = buildTemplateContent(base({ primaryColor: "#aa3300", sections: ["contact", "hero", "services"] }));
    expect(c.palette.primary).toBe("#aa3300");
    expect(c.sections).toEqual(["contact", "hero", "services"]);
  });

  it("caps services at 8 and drops the secondary CTA when there's no services section", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Service ${String.fromCharCode(65 + i)}`);
    const c = buildTemplateContent(base({ services: many, sections: ["hero", "contact"] }));
    expect(c.services).toHaveLength(8);
    expect(c.hero.secondaryCta).toBeUndefined();
  });

  it("handles very long names without breaking limits", () => {
    const name = "Établissements Commerciaux et Industriels de la Région Maritime du Togo SARL Unipersonnelle";
    const c = buildTemplateContent(base({ contact: { businessName: name.slice(0, 120) } }));
    expect(conceptContentSchema.safeParse(c).success).toBe(true);
    expect(c.seo.title.length).toBeLessThanOrEqual(60);
  });
});

describe("text helpers", () => {
  it("joins lists in both languages", () => {
    expect(joinList(["a", "b", "c"], "en")).toBe("a, b and c");
    expect(joinList(["a", "b"], "fr")).toBe("a et b");
    expect(joinList(["a"], "fr")).toBe("a");
  });
  it("lower-cases for sentences but keeps acronyms and brands", () => {
    expect(inSentence("Wedding photography")).toBe("wedding photography");
    expect(inSentence("SEO")).toBe("SEO");
    expect(inSentence("iPhone repair")).toBe("iPhone repair");
  });
  it("clamps at a word boundary", () => {
    expect(clampText("one two three four", 10)).toBe("one two…");
    expect(clampText("short", 10)).toBe("short");
  });
});

describe("conceptInputSchema", () => {
  const ok = {
    ref: { kind: "result", id: "0b9b3c7e-8a1f-4c7e-9b8e-2f1a3d4c5b6a" },
    services: [" Rooms ", "rooms", "", "Restaurant"],
    style: "modern",
    tone: "friendly",
    language: "fr",
    primaryColor: "#AA3300",
    contact: { businessName: "  Hôtel  Le Bénin ", phone: "", email: null, mapsUrl: "https://maps.app.goo.gl/abc" },
  };
  it("cleans and dedupes services, normalises colours, drops empty optional fields", () => {
    const v = conceptInputSchema.parse(ok);
    expect(v.services).toEqual(["Rooms", "Restaurant"]);
    expect(v.primaryColor).toBe("#aa3300");
    expect(v.contact.businessName).toBe("Hôtel Le Bénin");
    expect(v.contact.phone).toBeUndefined();
    expect(v.contact.email).toBeUndefined();
  });
  it("rejects bad values", () => {
    const bad = (patch: Record<string, unknown>) => conceptInputSchema.safeParse({ ...ok, ...patch }).success;
    expect(bad({ services: [] })).toBe(false);
    expect(bad({ services: Array.from({ length: 13 }, (_, i) => `s${i}`) })).toBe(false);
    expect(bad({ services: ["x".repeat(81)] })).toBe(false);
    expect(bad({ style: "neon" })).toBe(false);
    expect(bad({ primaryColor: "red" })).toBe(false);
    expect(bad({ notes: "x".repeat(1001) })).toBe(false);
    expect(bad({ contact: { businessName: "" } })).toBe(false);
    expect(bad({ contact: { businessName: "A", mapsUrl: "https://evil.example/maps" } })).toBe(false);
    expect(bad({ contact: { businessName: "A", mapsUrl: "http://www.google.com/maps" } })).toBe(false);
    expect(bad({ contact: { businessName: "A", phone: "javascript:alert(1)" } })).toBe(false);
    expect(bad({ contact: { businessName: "A", email: "not-an-email" } })).toBe(false);
    expect(bad({ ref: { kind: "result", id: "nope" } })).toBe(false);
  });
});
