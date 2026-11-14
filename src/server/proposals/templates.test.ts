import { describe, expect, it } from "vitest";
import { LANGUAGES, PROPOSAL_TOPICS, type Language, type ProposalTopic } from "@/lib/domain";
import { factsFromRow, sentenceCategory, whatsappDigits } from "./facts";
import { buildTemplate, countWords, CUSTOM_SERVICE_WARNING, NO_NAME_WARNING, SENDER_WARNING, tidy } from "./templates";
import { emptySender, fullRow, fullSender, minimalRow } from "./test-rows";

const NOW = new Date("2026-11-14T12:00:00Z");
const COMBOS = PROPOSAL_TOPICS.flatMap((topic) => LANGUAGES.map((language) => [topic, language] as [ProposalTopic, Language]));

/** Things that must never appear in a generated message. */
function expectClean(text: string) {
  expect(text).not.toMatch(/\b(?:undefined|null|NaN|N\/A)\b/);
  expect(text).not.toMatch(/[{}]/);
  expect(text).not.toMatch(/\(\s*\)|\[\s*\]|«\s*»|“\s*”/);
  expect(text).not.toMatch(/ {2,}/);
  expect(text).not.toMatch(/ [,.]/);
  expect(text).not.toMatch(/\n{3,}/);
  expect(text).not.toMatch(/^\s|\s$/);
}

const build = (topic: ProposalTopic, language: Language, row = fullRow(), extra: Partial<Parameters<typeof buildTemplate>[0]> = {}) =>
  buildTemplate({
    topic,
    language,
    facts: factsFromRow(row, NOW),
    sender: fullSender({ defaultLanguage: language }),
    customService: "Professional photo shoots",
    ...extra,
  });

describe("buildTemplate — every topic × language", () => {
  it.each(COMBOS)("%s / %s with full facts is clean, personal and the right length", (topic, language) => {
    const t = build(topic, language);
    expectClean(t.subject);
    expectClean(t.body);
    expect(t.subject.length).toBeLessThanOrEqual(120);
    expect(t.body).toContain("Hôtel Le Bénin");
    expect(t.factsUsed.businessName).toBe("Hôtel Le Bénin");
    // Category is lower-cased inside sentences.
    expect(t.body).toContain("hotel");
    expect(t.body).not.toMatch(/, an? Hotel|, Hotel à/);
    expect(t.body).toContain("Lomé");
    const words = countWords(t.body, fullSender({ defaultLanguage: language }), language);
    expect(words).toBeGreaterThanOrEqual(110);
    expect(words).toBeLessThanOrEqual(190);
    expect(t.warnings).toEqual([]);
  });

  it.each(COMBOS)("%s / %s with minimal facts omits what is missing", (topic, language) => {
    const t = buildTemplate({ topic, language, facts: factsFromRow(minimalRow(), NOW), sender: emptySender() });
    expectClean(t.subject);
    expectClean(t.body);
    expect(t.body).not.toMatch(/star|étoile|\/5|avis|reviews|©|HTTPS/);
    expect(t.factsUsed).not.toHaveProperty("rating");
    expect(t.factsUsed).not.toHaveProperty("city");
    expect(t.factsUsed).not.toHaveProperty("businessName");
    expect(t.warnings).toContain(SENDER_WARNING);
    expect(t.warnings).toContain(NO_NAME_WARNING);
    if (topic === "custom") expect(t.warnings).toContain(CUSTOM_SERVICE_WARNING);
  });

  it.each(PROPOSAL_TOPICS)("French %s uses Bonjour, vouvoiement and Cordialement", (topic) => {
    const t = build(topic, "fr");
    expect(t.body.startsWith("Bonjour,")).toBe(true);
    expect(t.body).toMatch(/\bvous\b|\bvotre\b|\bvos\b/);
    expect(t.body).not.toMatch(/\btu\b|\bton\b|\bta\b|\btes\b/);
    expect(t.body).toContain("Cordialement,");
    expect(t.body).not.toMatch(/Hello|Best regards/);
  });

  it.each(PROPOSAL_TOPICS)("English %s greets the business and signs off", (topic) => {
    const t = build(topic, "en");
    expect(t.body.startsWith("Hello Hôtel Le Bénin team,")).toBe(true);
    expect(t.body).toMatch(/Best regards,\nKofi Mensah\nAtelier Web\n\+228 90 00 00 00 · kofi@atelier\.example\natelier\.example$/);
  });
});

describe("rating sentence", () => {
  const ratingText = (topic: ProposalTopic, language: Language, o: Parameters<typeof fullRow>[0]) => build(topic, language, fullRow(o)).body;

  it("is included only when rating ≥ 4.0 and at least 5 reviews", () => {
    for (const language of LANGUAGES) {
      expect(ratingText("new_website", language, { rating: 4.0, reviewCount: 5 })).toMatch(language === "en" ? /4-star rating from 5 reviews/ : /4\/5 sur Google Maps \(5 avis\)/);
      expect(ratingText("new_website", language, { rating: 3.9, reviewCount: 500 })).not.toMatch(/star|\/5/);
      expect(ratingText("new_website", language, { rating: 4.8, reviewCount: 4 })).not.toMatch(/star|\/5/);
      expect(ratingText("new_website", language, { rating: null, reviewCount: 50 })).not.toMatch(/star|\/5/);
      expect(ratingText("new_website", language, { rating: 4.5, reviewCount: null })).not.toMatch(/star|\/5/);
    }
  });

  it("formats decimals per language (4.6 / 4,6)", () => {
    expect(ratingText("branding", "en", { rating: 4.62, reviewCount: 1234 })).toContain("4.6-star rating from 1,234 reviews on Google Maps");
    expect(ratingText("branding", "fr", { rating: 4.62, reviewCount: 87 })).toContain("4,6/5 sur Google Maps (87 avis)");
  });

  it("mentions Google Maps only for Google data", () => {
    for (const topic of PROPOSAL_TOPICS) {
      for (const language of LANGUAGES) {
        const google = build(topic, language, fullRow({ source: "google_places" }));
        const sample = build(topic, language, fullRow({ source: "sample" }));
        expect(google.body).toMatch(/reviews on Google Maps|sur Google Maps \(87 avis\)/);
        expect(google.factsUsed.ratingSource).toBe("Google Maps");
        expect(sample.body).not.toMatch(/reviews on Google Maps|sur Google Maps \(/);
        expect(sample.body).toMatch(/87 reviews|87 avis/);
        expect(sample.factsUsed).not.toHaveProperty("ratingSource");
      }
    }
  });
});

describe("website facts", () => {
  it("lists real issues from our own website check", () => {
    const en = build("website_redesign", "en");
    expect(en.body).toContain("hotel-le-benin.example");
    expect(en.body).toContain("secure connection (HTTPS)");
    expect(en.body).toContain("optimised for phone screens");
    expect(en.body).toContain("your site's footer still says © 2017");
    expect(en.factsUsed.websiteIssues).toBe("no HTTPS; not mobile-friendly; © 2017");
    const fr = build("website_redesign", "fr");
    expect(fr.body).toContain("indique encore © 2017");
  });

  it("only calls a © year old when it is at least 3 years old", () => {
    const check = { status: "ok" as const, https: true, mobileViewport: true, checkedAt: NOW.toISOString() };
    expect(build("website_redesign", "en", fullRow({ websiteCheck: { ...check, copyrightYear: 2023 } })).body).toContain("© 2023");
    expect(build("website_redesign", "en", fullRow({ websiteCheck: { ...check, copyrightYear: 2024 } })).body).not.toContain("©");
  });

  it("ignores site signals when the crawl didn't load the site", () => {
    const t = build("website_redesign", "en", fullRow({ websiteCheck: { status: "unreachable", https: false, copyrightYear: 2010, checkedAt: NOW.toISOString() } }));
    expect(t.body).not.toMatch(/HTTPS|©|had a look/);
    expect(t.factsUsed).not.toHaveProperty("websiteIssues");
  });

  it("states the missing website only when we know there is none", () => {
    const none = fullRow({ websiteStatus: "none", website: null, websiteHost: null, websiteCheck: null });
    expect(build("new_website", "en", none).body).toContain("Hôtel Le Bénin, a hotel in Lomé, and noticed you don't have a website yet.");
    expect(build("new_website", "fr", none).body).toContain("J'ai découvert Hôtel Le Bénin, hotel à Lomé, et j'ai remarqué que vous n'avez pas encore de site web.");
    expect(build("new_website", "en", none).factsUsed.websiteStatus).toBe("none");
    expect(build("new_website", "en").body).not.toContain("don't have a website");
    // The pitch: search first, WhatsApp button, Google Maps location.
    const pitch = build("new_website", "en", none).body;
    expect(pitch).toContain("look a business up online");
    expect(pitch).toContain("WhatsApp button");
    expect(pitch).toContain("Google Maps location");
  });

  it("mentions social networks only when we found them", () => {
    expect(build("social_media", "en").body).toContain("already on Facebook and Instagram");
    expect(build("social_media", "fr").body).toContain("utilisez déjà Facebook et Instagram");
    const none = build("social_media", "en", fullRow({ socials: {} }));
    expect(none.body).toContain("couldn't find any social media pages linked from your website");
    const unchecked = build("social_media", "en", fullRow({ socials: {}, websiteCheck: null }));
    expect(unchecked.body).not.toMatch(/couldn't find|already on/);
  });
});

describe("sender, concept and custom service", () => {
  it("adds a shared concept link and lists it in factsUsed", () => {
    const url = "http://localhost:3000/c/abc123";
    for (const language of LANGUAGES) {
      const t = build("new_website", language, fullRow(), { conceptUrl: url });
      expect(t.body).toContain(url);
      expect(t.factsUsed.conceptUrl).toBe(url);
    }
    expect(build("new_website", "en").factsUsed).not.toHaveProperty("conceptUrl");
  });

  it("uses the saved signature when there is one", () => {
    const t = buildTemplate({
      topic: "branding",
      language: "fr",
      facts: factsFromRow(fullRow(), NOW),
      sender: { ...emptySender(), signature: "Ama — Studio Lomé\nWhatsApp +228 91 00 00 00" },
    });
    expect(t.body.endsWith("Cordialement,\nAma — Studio Lomé\nWhatsApp +228 91 00 00 00")).toBe(true);
    expect(t.warnings).not.toContain(SENDER_WARNING);
  });

  it("warns when the sender has a name but no contact details", () => {
    const t = buildTemplate({ topic: "branding", language: "en", facts: factsFromRow(fullRow(), NOW), sender: { ...emptySender(), senderName: "Kofi" } });
    expect(t.warnings).toContain(SENDER_WARNING);
    expect(t.body).toContain("My name is Kofi.");
  });

  it("weaves the custom service into the message", () => {
    const t = build("custom", "en", fullRow(), { customService: "Menu design." });
    expect(t.body).toContain("I help local businesses with menu design.");
    expect(t.subject).toBe("Menu design for Hôtel Le Bénin");
    expect(t.factsUsed.customService).toBe("menu design");
  });

  it("cleans untrusted names (control characters, line breaks, extra spaces)", () => {
    const t = build("new_website", "en", fullRow({ name: "  Chez\u0000 Ama\n\n  Maquis  " }));
    expect(t.body).toContain("Hello Chez Ama Maquis team,");
    expectClean(t.body);
  });

  it("caps very long subjects", () => {
    const t = build("custom", "en", fullRow({ name: "N".repeat(110) }), { customService: "S".repeat(150) });
    expect(t.subject.length).toBeLessThanOrEqual(120);
  });
});

describe("helpers", () => {
  it("lower-cases categories but keeps acronyms", () => {
    expect(sentenceCategory("Italian Restaurant")).toBe("italian restaurant");
    expect(sentenceCategory("BTP Contractor")).toBe("BTP contractor");
    expect(sentenceCategory("car_repair")).toBe("car repair");
    expect(sentenceCategory("  ")).toBeNull();
  });

  it("builds WhatsApp digits only from valid E.164 numbers", () => {
    expect(whatsappDigits("+22890123456")).toBe("22890123456");
    expect(whatsappDigits("+233 24 123 4567")).toBe("233241234567");
    expect(whatsappDigits("90123456")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
  });

  it("tidies spacing and blank lines", () => {
    expect(tidy("Hello  there ,\n\n\n\nBye .  ")).toBe("Hello there,\n\nBye.");
  });
});
