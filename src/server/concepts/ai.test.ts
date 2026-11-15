import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "../auth/session";
import { aiConceptSchema, allowedNumbers, conceptInstructions, conceptPromptData, conceptSystemPrompt, finalizeAiContent, type AiConceptDraft } from "./ai";
import { STYLE_PALETTES, contrastRatio } from "./design";
import { generateConceptContent, type ConceptAiGenerate } from "./generate";
import { conceptContentSchema, type ConceptOptions } from "./schema";
import { buildTemplateContent } from "./template";

const user: AppUser = { id: "u1", name: "Test", email: "t@test.local", role: "member", status: "active" };

const input = (over: Partial<ConceptOptions> = {}): ConceptOptions => ({
  services: ["Plumbing repairs", "Water heater installation", "Bathroom renovation"],
  style: "natural",
  tone: "friendly",
  language: "en",
  notes: "Family business, open since 2015.",
  contact: { businessName: "Plomberie Akossiwa", phone: "+228 90 12 34 56", city: "Lomé" },
  ...over,
});

const draft = (over: Partial<AiConceptDraft> = {}): AiConceptDraft => ({
  siteTitle: "Plomberie Akossiwa",
  tagline: "Friendly plumbing in Lomé",
  hero: { headline: "Plumbing you can count on", subheadline: "Repairs, water heaters and bathrooms. We've served 500 happy clients!", primaryCta: "Call us", secondaryCta: "Our services" },
  about: { heading: "About us", body: "We are a family business. We have been open since 2015. Over 20 years of experience. We're award-winning plumbers." },
  services: [
    { title: "Plumbing repairs", description: "Leaks and blocked pipes fixed. Prices from 5000 CFA." },
    { title: "Water heater installation", description: "Installation and maintenance." },
    { title: "24/7 emergencies", description: "Always available." },
  ],
  highlights: [
    { title: "Family business", description: "A friendly team that listens." },
    { title: "15 years of experience", description: "Since the start." },
    { title: "Certified", description: "Fully certified plumbers." },
  ],
  gallery: { ideas: ["A repaired sink", "“Best plumber ever” — a customer"] },
  contact: { heading: "Contact", body: "Call us today." },
  palette: { primary: "#1d6b44", secondary: "#3a2f25", accent: "#a7c957", background: "#fbfaf6", surface: "#eef2e6", text: "#1c241c" },
  typography: { pairing: "classic" },
  seo: { title: "Plomberie Akossiwa — plumbing in Lomé", metaDescription: "Friendly plumbing repairs in Lomé." },
  sections: ["hero", "services", "about", "highlights", "contact"],
  ...over,
});

const fakeAi = (data: AiConceptDraft): ConceptAiGenerate => vi.fn(async () => ({ ok: true as const, data, model: "test/model" }));

describe("prompt", () => {
  it("system prompt forbids invented facts and sets the language", () => {
    const p = conceptSystemPrompt("fr");
    expect(p).toMatch(/web designer writing homepage copy for a small local business/);
    expect(p).toMatch(/Do not invent statistics/);
    expect(p).toMatch(/testimonials/);
    expect(p).toMatch(/in French/);
  });
  it("data block carries only user-confirmed facts (no phone numbers)", () => {
    const d = conceptPromptData(input());
    expect(JSON.stringify(d)).not.toContain("90 12 34 56");
    expect(d.contactChannels).toEqual({ phone: true, whatsapp: false, email: false });
    expect(conceptInstructions(input())).toMatch(/starts a phone call/);
  });
  it("the AI output schema accepts the draft shape", () => {
    expect(aiConceptSchema.safeParse(draft()).success).toBe(true);
  });
});

describe("finalizeAiContent", () => {
  const tpl = buildTemplateContent(input());

  it("removes sentences and items with numbers not in the input, keeps those that are", () => {
    expect([...allowedNumbers(input())]).toEqual(expect.arrayContaining(["2015", "228", "90"]));
    const { content, warnings } = finalizeAiContent(draft(), input(), tpl);
    // "since 2015" is in the user's notes → kept. "20 years", "500 clients", "5000 CFA" → removed.
    expect(content.about.body).toContain("We have been open since 2015.");
    expect(content.about.body).not.toMatch(/20 years|award/);
    expect(content.hero.subheadline).toBe("Repairs, water heaters and bathrooms.");
    expect(content.services.map((s) => s.title)).toEqual(["Plumbing repairs", "Water heater installation"]);
    expect(content.services[0]!.description).toBe("Leaks and blocked pipes fixed.");
    expect(content.highlights.map((h) => h.title)).toEqual(["Family business"]);
    expect(content.gallery.ideas).toEqual(["A repaired sink"]);
    expect(warnings.some((w) => /Removed \d+ AI sentences/.test(w))).toBe(true);
    // Testimonials are always our own placeholder guidance.
    expect(content.testimonialsNote).toBe(tpl.testimonialsNote);
    expect(conceptContentSchema.safeParse(content).success).toBe(true);
  });

  it("falls back to the template for a field emptied by the checks", () => {
    const { content } = finalizeAiContent(draft({ hero: { headline: "Serving Lomé for 30 years", subheadline: "Over 1000 jobs done.", primaryCta: "Call us" } }), input(), tpl);
    expect(content.hero.headline).toBe(tpl.hero.headline);
    expect(content.hero.subheadline).toBe(tpl.hero.subheadline);
  });

  it("falls back to the style palette when colours are invalid", () => {
    const { content, warnings } = finalizeAiContent(draft({ palette: { ...draft().palette, primary: "green", text: "#12" } }), input(), tpl);
    expect(content.palette).toEqual(STYLE_PALETTES.natural);
    expect(warnings.join(" ")).toMatch(/weren't valid/);
  });

  it("enforces text contrast ≥ 4.5:1 (falls back otherwise)", () => {
    const low = { ...draft().palette, background: "#ffffff", surface: "#f5f5f5", text: "#999999" };
    expect(contrastRatio(low.text, low.background)).toBeLessThan(4.5);
    const { content, warnings } = finalizeAiContent(draft({ palette: low }), input(), tpl);
    expect(content.palette).toEqual(STYLE_PALETTES.natural);
    expect(warnings.join(" ")).toMatch(/contrast/);
    expect(contrastRatio(content.palette.text, content.palette.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a good AI palette but the user's primary colour wins", () => {
    const { content } = finalizeAiContent(draft(), input({ primaryColor: "#cc5500" }), buildTemplateContent(input({ primaryColor: "#cc5500" })));
    expect(content.palette.primary).toBe("#cc5500");
    expect(content.palette.background).toBe("#fbfaf6");
  });

  it("limits sections to what the user asked for, in the user's order", () => {
    const chosen = input({ sections: ["contact", "services", "hero"] });
    const { content } = finalizeAiContent(draft({ sections: ["hero", "gallery", "services", "testimonials"] }), chosen, buildTemplateContent(chosen));
    expect(content.sections).toEqual(["contact", "services", "hero"]);
    const free = finalizeAiContent(draft({ sections: ["hero", "bogus", "services", "hero"] }), input(), tpl);
    expect(free.content.sections).toEqual(["hero", "services"]);
  });

  it("removes unverifiable claims in French too", () => {
    const fr = input({ language: "fr" });
    const { content } = finalizeAiContent(
      draft({ about: { heading: "À propos", body: "Une entreprise familiale. Nous sommes certifiés et primés. Satisfaction garantie !" } }),
      fr,
      buildTemplateContent(fr),
    );
    expect(content.about.body).toBe("Une entreprise familiale.");
  });
});

describe("generateConceptContent", () => {
  it("uses the injected AI and post-checks its output", async () => {
    const gen = fakeAi(draft());
    const r = await generateConceptContent(user, input(), {}, { generate: gen });
    expect(r.generatedBy).toBe("ai");
    expect(r.model).toBe("test/model");
    expect(r.content.about.body).not.toContain("20 years");
    expect(gen).toHaveBeenCalledWith(expect.objectContaining({ operation: "concept", user, schema: aiConceptSchema }));
  });

  it("uses the template when AI is not configured, or not wanted", async () => {
    const gen = fakeAi(draft());
    const off = await generateConceptContent(user, input(), {}, { aiAvailable: () => false });
    expect(off).toMatchObject({ generatedBy: "template", model: null, warnings: [] });
    const notWanted = await generateConceptContent(user, input(), { useAi: false }, { generate: gen });
    expect(notWanted.generatedBy).toBe("template");
    expect(gen).not.toHaveBeenCalled();
  });

  it("falls back to the template with a warning when the AI fails or throws", async () => {
    const failed = await generateConceptContent(user, input(), {}, {
      generate: async () => ({ ok: false, reason: "limit_reached", message: "You've used all 50 AI generations for today." }),
    });
    expect(failed.generatedBy).toBe("template");
    expect(failed.content).toEqual(buildTemplateContent(input()));
    expect(failed.warnings[0]).toBe("You've used all 50 AI generations for today. Showing the template version instead.");
    const threw = await generateConceptContent(user, input(), {}, {
      generate: async () => {
        throw new Error("boom");
      },
    });
    expect(threw.generatedBy).toBe("template");
    expect(threw.warnings).toHaveLength(1);
  });
});
