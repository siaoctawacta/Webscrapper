import { describe, expect, it } from "vitest";
import { renderConceptHtml, escapeHtml, type RenderContact } from "./render";
import { conceptContentSchema, type ConceptContent } from "./schema";
import { buildTemplateContent } from "./template";

const XSS = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `' onmouseover='alert(1)`,
  `javascript:alert(1)`,
  `</style><script>alert(1)</script>`,
  "`${alert(1)}`",
  `<svg/onload=alert(1)>`,
  `<a href="javascript:alert(1)">x</a>`,
];
const X = XSS.join(" ");

function xssContent(): ConceptContent {
  const item = { title: X, description: X };
  return {
    siteTitle: X,
    tagline: X,
    hero: { headline: X, subheadline: X, primaryCta: X, secondaryCta: X },
    about: { heading: X, body: X },
    services: [item, item],
    highlights: [item],
    testimonialsNote: X,
    gallery: { ideas: [X, X] },
    contact: { heading: X, body: X },
    // Bypass validation on purpose: the renderer must be safe even with unvalidated content.
    palette: {
      primary: "red;}</style><script>alert(1)</script>",
      secondary: "#000000; background:url(javascript:alert(1))",
      accent: "expression(alert(1))",
      background: "#fff",
      surface: "#ffffff",
      text: "#000000",
    },
    typography: { pairing: `modern-sans";}</style><script>alert(1)</script>` as ConceptContent["typography"]["pairing"] },
    seo: { title: X, metaDescription: X },
    sections: ["hero", "services", "about", "highlights", "gallery", "testimonials", "contact"],
  };
}

const xssContact: RenderContact = {
  businessName: X,
  phone: `javascript:alert(1)`,
  whatsapp: `"><script>alert(1)</script>`,
  email: `x@y.com" onclick="alert(1)`,
  address: X,
  city: X,
  mapsUrl: `javascript:alert(1)//https://www.google.com/maps`,
};

/** Every attribute name and every href/src value in the document. */
function attributes(html: string) {
  const names: string[] = [];
  const hrefs: string[] = [];
  for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*>/gi)) {
    for (const a of (tag[2] ?? "").matchAll(/\s+([^\s=>]+)(?:="([^"]*)")?/g)) {
      const name = a[1]!.toLowerCase();
      names.push(name);
      if (name === "href") hrefs.push(a[2] ?? "");
    }
  }
  // Every "<tag" in the document must have been parsed as a well-formed tag.
  const opened = (html.match(/<[a-z]/gi) ?? []).length;
  const parsed = [...html.matchAll(/<([a-z][a-z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*>/gi)].length;
  expect(parsed).toBe(opened);
  return { names, hrefs };
}

const ALLOWED_HREF = /^(#[a-z][a-z0-9-]*|tel:\+?\d+|mailto:[^"<>\s]+|https:\/\/[^"<>\s]+)$/;

describe("renderConceptHtml — escaping", () => {
  const html = renderConceptHtml(xssContent(), xssContact, { footerCredit: X, year: 2026 });

  it("produces no executable markup from any field", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/<iframe|<object|<embed|<form|<base|<link|<meta http-equiv/i);
    expect(html).not.toMatch(/href="\s*javascript:/i);
    // The only <style> is ours and it is closed exactly once.
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it("has no inline event handlers and only allowed attributes", () => {
    const { names } = attributes(html);
    expect(names.some((n) => n.startsWith("on"))).toBe(false);
    const allowed = new Set(["lang", "charset", "name", "content", "class", "href", "rel", "id", "aria-label", "aria-labelledby", "aria-hidden", "role", "style"]);
    for (const n of names) expect(allowed.has(n), `unexpected attribute ${n}`).toBe(true);
  });

  it("drops links with disallowed schemes", () => {
    const { hrefs } = attributes(html);
    for (const h of hrefs) expect(h, h).toMatch(ALLOWED_HREF);
    expect(html).not.toMatch(/href="[^"]*javascript/i);
    // Unusable phone / WhatsApp / email / maps values produce no links at all.
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("google.com/maps");
  });

  it("ignores CSS injection in colours and fonts", () => {
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(style).not.toMatch(/url\(|expression|javascript|@import|<\//i);
    // Invalid palette → the preset palette is used as a whole.
    expect(style).toContain("--primary:#2563eb");
    expect(style).toMatch(/--heading-font:system-ui/);
  });

  it("escapes the text so it is shown literally", () => {
    expect(html).toContain(escapeHtml(XSS[0]));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes every special character, strips control characters", () => {
    expect(escapeHtml(`<>&"'\``)).toBe("&lt;&gt;&amp;&quot;&#39;&#96;");
    expect(escapeHtml("a\u0000b‮c")).toBe("abc");
  });
});

describe("renderConceptHtml — links and structure", () => {
  const input = {
    services: ["Rooms", "Restaurant", "Airport pick-up"],
    style: "modern" as const,
    tone: "professional" as const,
    language: "en" as const,
    contact: {
      businessName: "Hôtel Le Bénin",
      phone: "+228 90 12 34 56",
      whatsapp: "+228 90 12 34 56",
      email: "contact@hotel-le-benin.example",
      address: "Boulevard du 13 Janvier",
      city: "Lomé",
      mapsUrl: "https://www.google.com/maps/place/?q=place_id:abc",
    },
  };
  const content = buildTemplateContent(input);

  it("builds tel:, wa.me, mailto: and Google Maps links only from the contact block", () => {
    const html = renderConceptHtml(content, input.contact, { year: 2026 });
    expect(html).toContain('href="tel:+22890123456"');
    expect(html).toContain('href="https://wa.me/22890123456"');
    expect(html).toContain('href="mailto:contact@hotel-le-benin.example"');
    expect(html).toContain('href="https://www.google.com/maps/place/?q=place_id:abc"');
    expect(html).toContain("Open in Google Maps");
    for (const h of attributes(html).hrefs) expect(h).toMatch(ALLOWED_HREF);
    // External links never leak the referrer.
    expect(html).toMatch(/href="https:\/\/wa\.me\/22890123456" rel="noopener noreferrer nofollow"/);
  });

  it("primary CTA → WhatsApp, then phone, then #contact", () => {
    const wa = renderConceptHtml(content, input.contact);
    expect(wa).toMatch(/class="btn btn-primary" href="https:\/\/wa\.me\/22890123456"/);
    const tel = renderConceptHtml(content, { ...input.contact, whatsapp: null });
    expect(tel).toMatch(/class="btn btn-primary" href="tel:\+22890123456"/);
    const none = renderConceptHtml(content, { businessName: "X" });
    expect(none).toMatch(/class="btn btn-primary" href="#contact"/);
    // The Maps link is limited to Google Maps URLs.
    const other = renderConceptHtml(content, { businessName: "X", mapsUrl: "https://evil.example/maps" });
    expect(other).not.toContain("evil.example");
  });

  it("is a complete standalone document with viewport, title, description and no external resources", () => {
    const html = renderConceptHtml(content, input.contact, { footerCredit: "Studio Kekeli", year: 2026 });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain(`<title>${escapeHtml(content.seo.title)}</title>`);
    expect(html).toContain(`<meta name="description" content="${escapeHtml(content.seo.metaDescription)}">`);
    expect(html).not.toMatch(/src=|@import|url\(|<link/i);
    expect(html).toContain("© 2026 Hôtel Le Bénin");
    expect(html).toContain("Homepage concept by Studio Kekeli");
  });

  it("respects the section order and leaves out unlisted sections and their nav links", () => {
    const ordered = conceptContentSchema.parse({ ...content, sections: ["contact", "hero", "services"] });
    const html = renderConceptHtml(ordered, input.contact);
    const pos = (id: string) => html.indexOf(`id="${id}"`);
    expect(pos("contact")).toBeGreaterThan(0);
    expect(pos("contact")).toBeLessThan(pos("top"));
    expect(pos("top")).toBeLessThan(pos("services"));
    expect(html).not.toContain('id="about"');
    expect(html).not.toContain('id="gallery"');
    expect(html).not.toContain('href="#about"');
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(nav.indexOf("#contact")).toBeLessThan(nav.indexOf("#services"));
  });

  it("marks the testimonials block as a placeholder and gallery tiles as photo ideas", () => {
    const html = renderConceptHtml(content, input.contact);
    expect(html).toMatch(/<span class="badge">Placeholder<\/span>/);
    expect(html).toContain("Photo idea: Rooms — a real photo of your work");
  });

  it("renders French labels", () => {
    const fr = buildTemplateContent({ ...input, language: "fr" });
    const html = renderConceptHtml(fr, input.contact, { language: "fr", footerCredit: "Studio Kekeli" });
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Ouvrir dans Google Maps");
    expect(html).toContain("Emplacement réservé");
    expect(html).toContain("Proposition de page d'accueil par Studio Kekeli".replace("'", "&#39;"));
  });
});
