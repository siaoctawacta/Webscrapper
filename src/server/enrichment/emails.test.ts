import { describe, expect, it } from "vitest";
import { registrableDomain } from "./domain";
import {
  cfEmailFromHref,
  decodeCfEmail,
  findObfuscatedEmails,
  findTextEmails,
  isAssetLike,
  isPlaceholderEmail,
  isValidEmailSyntax,
  normalizeEmailCandidate,
  rankEmails,
} from "./emails";
import { encodeCfEmail } from "./test-server";


describe("normalizeEmailCandidate", () => {
  it("cleans mailto hrefs: scheme, query, percent-encoding, case", () => {
    expect(normalizeEmailCandidate("mailto:Info@Hotel-Benin.TG?subject=R%C3%A9servation")).toBe("info@hotel-benin.tg");
    expect(normalizeEmailCandidate("MAILTO:contact%40hotel.tg")).toBe("contact@hotel.tg");
    expect(normalizeEmailCandidate("mailto:a@hotel.tg,b@hotel.tg")).toBe("a@hotel.tg");
    expect(normalizeEmailCandidate("  <reservations@lodge.com.gh>. ")).toBe("reservations@lodge.com.gh");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["mailto:", "info@", "@hotel.tg", "info@hotel", "in..fo@hotel.tg", ".info@hotel.tg", "info@-hotel.tg", "info@hotel.t", "info@hotel.123", `${"a".repeat(65)}@hotel.tg`, `a@${"b".repeat(250)}.tg`, "mailto:%E0%A4%A"]) {
      expect(normalizeEmailCandidate(bad), bad).toBeNull();
    }
  });

  it("keeps the length limit of 254 characters", () => {
    const local = "a".repeat(64);
    const label = "b".repeat(60);
    const ok = `${local}@${label}.${label}.${label}.tg`;
    expect(ok.length).toBeLessThanOrEqual(254);
    expect(isValidEmailSyntax(ok)).toBe(true);
    expect(isValidEmailSyntax(`${local}@${label}.${label}.${label}.${"c".repeat(10)}.tg`)).toBe(false);
  });

  it("drops asset-like names and version strings", () => {
    for (const junk of ["logo@2x.png", "banner@3x.webp", "hero-image@1.5x.jpg", "icon@2x.jpeg", "sprite@2x.svg", "style@site.css", "app@main.js", "photo@hotel.gif", "jquery@3.6.0", "bootstrap@5.3.2.min.js"]) {
      expect(normalizeEmailCandidate(junk), junk).toBeNull();
    }
    expect(isAssetLike("logo@2x.png")).toBe(true);
    expect(isAssetLike("info@hotel.tg")).toBe(false);
  });

  it("drops placeholders, vendor and tracking addresses", () => {
    for (const junk of [
      "john.doe@example.com",
      "info@example.org",
      "contact@example.net",
      "contact@exemple.fr",
      "you@domain.com",
      "contact@email.com",
      "yourname@hotel.tg",
      "name@hotel.tg",
      "user@hotel.tg",
      "test@hotel.tg",
      "votre.email@hotel.tg",
      "605a7baede844d278b89dc95ae0a9123@sentry.wixpress.com",
      "abc@o123.ingest.sentry.io",
      "support@wixpress.com",
      "help@godaddy.com",
      "noreply@cloudflare.com",
      "noreply@hotel.tg",
      "info@hotel.local",
      "info@hotel.test",
      "info@shop.example",
    ]) {
      expect(normalizeEmailCandidate(junk), junk).toBeNull();
    }
    expect(isPlaceholderEmail("reservation@hotel.tg")).toBe(false);
  });

  it("keeps real-looking business addresses (incl. common providers)", () => {
    for (const ok of ["reservation@hotel-sarakawa.tg", "goldenpalm.lodge@gmail.com", "info@lodge.com.gh", "contact@xn--htel-dpa.fr", "sales+web@shop.co.uk"]) {
      expect(normalizeEmailCandidate(ok), ok).toBe(ok);
    }
  });
});

describe("Cloudflare email protection", () => {
  it("decodes data-cfemail payloads", () => {
    expect(decodeCfEmail(encodeCfEmail("booking@hotel-benin.tg"))).toBe("booking@hotel-benin.tg");
    expect(decodeCfEmail(encodeCfEmail("réservation@hôtel.tg", 0x13))).toBe("réservation@hôtel.tg");
    expect(decodeCfEmail("zz")).toBeNull();
    expect(decodeCfEmail("abc")).toBeNull();
  });

  it("decodes /cdn-cgi/l/email-protection#hex links", () => {
    expect(cfEmailFromHref(`/cdn-cgi/l/email-protection#${encodeCfEmail("info@hotel.tg")}`)).toBe("info@hotel.tg");
    expect(cfEmailFromHref("/cdn-cgi/l/email-protection")).toBeNull();
  });
});

describe("text and obfuscated emails", () => {
  it("finds plain addresses in text", () => {
    expect(findTextEmails("Écrivez-nous : Info@Hotel.tg ou reservation@hotel.tg. Merci")).toEqual(["info@hotel.tg", "reservation@hotel.tg"]);
    expect(findTextEmails("logo@2x.png jquery@3.6.0 nothing here")).toEqual([]);
  });

  it("decodes [at] / (at) / {at} / [arobase] and [dot] / (point) styles", () => {
    expect(findObfuscatedEmails("Contact: direction [at] hotel-benin [dot] tg")).toEqual(["direction@hotel-benin.tg"]);
    expect(findObfuscatedEmails("contact(at)lodge.com.gh")).toEqual(["contact@lodge.com.gh"]);
    expect(findObfuscatedEmails("sales { at } shop (dot) co (dot) uk")).toEqual(["sales@shop.co.uk"]);
    expect(findObfuscatedEmails("info [arobase] hotel (point) tg")).toEqual(["info@hotel.tg"]);
    expect(findObfuscatedEmails("info [at] hotel [dot] tg. Call us")).toEqual(["info@hotel.tg"]);
    expect(findObfuscatedEmails("name [at] domain [dot] com")).toEqual([]); // placeholder
    expect(findObfuscatedEmails("we are at the hotel. dot com bubble")).toEqual([]);
  });

  it("never cuts an address glued to other letters (accents, any script) into a shorter one", () => {
    // Without these checks "réservation@…" would yield the invented address "servation@…".
    expect(findTextEmails("Écrivez à réservation@hotel-benin.tg ou jérôme@hotel.tg")).toEqual([]);
    expect(findTextEmails("info@hôtel.tg contact@hotel.tgé a@b@hotel.tg")).toEqual([]);
    expect(findTextEmails("Tél/Email:info@hotel.tg, (contact@hotel.tg)")).toEqual(["info@hotel.tg", "contact@hotel.tg"]);
    expect(findObfuscatedEmails("réservation [at] hotel [dot] tg")).toEqual([]);
    expect(findObfuscatedEmails(`${"k".repeat(70)} [at] hotel [dot] tg`)).toEqual([]);
    expect(findObfuscatedEmails("info [at] hotel [dot] tgé")).toEqual([]);
    expect(findObfuscatedEmails("Écrivez : accueil [at] hotel [dot] tg")).toEqual(["accueil@hotel.tg"]);
  });

  it("stays fast on long runs of address-like characters (adversarial pages)", () => {
    const size = 1.5 * 1024 * 1024;
    for (const text of ["a".repeat(size), "a.".repeat(size / 2), "a-b-".repeat(size / 4), "x [at] ".repeat(size / 7)]) {
      const t0 = performance.now();
      findTextEmails(text);
      findObfuscatedEmails(text);
      expect(performance.now() - t0).toBeLessThan(750);
    }
  });
});

describe("rankEmails", () => {
  it("puts addresses on the site's registrable domain first, dedupes, keeps the first source, max 5", () => {
    const ranked = rankEmails(
      [
        { email: "hotel.benin@gmail.com", sourceUrl: "https://www.hotel-benin.tg/" },
        { email: "info@hotel-benin.tg", sourceUrl: "https://www.hotel-benin.tg/" },
        { email: "INFO@hotel-benin.tg", sourceUrl: "https://www.hotel-benin.tg/contact" },
        { email: "sales@mail.hotel-benin.tg", sourceUrl: "https://www.hotel-benin.tg/contact" },
        { email: "agency@webdesign.com", sourceUrl: "https://www.hotel-benin.tg/" },
        { email: "a@b.com", sourceUrl: "https://www.hotel-benin.tg/" },
        { email: "c@d.com", sourceUrl: "https://www.hotel-benin.tg/" },
      ],
      ["hotel-benin.tg", "www.hotel-benin.tg"],
    );
    expect(ranked).toEqual([
      { email: "info@hotel-benin.tg", sourceUrl: "https://www.hotel-benin.tg/", sameDomain: true },
      { email: "sales@mail.hotel-benin.tg", sourceUrl: "https://www.hotel-benin.tg/contact", sameDomain: true },
      { email: "hotel.benin@gmail.com", sourceUrl: "https://www.hotel-benin.tg/", sameDomain: false },
      { email: "agency@webdesign.com", sourceUrl: "https://www.hotel-benin.tg/", sameDomain: false },
      { email: "a@b.com", sourceUrl: "https://www.hotel-benin.tg/", sameDomain: false },
    ]);
  });
});

describe("registrableDomain", () => {
  it.each([
    ["www.hotel-benin.tg", "hotel-benin.tg"],
    ["shop.hotel.com", "hotel.com"],
    ["www.lodge.com.gh", "lodge.com.gh"],
    ["mail.shop.co.uk", "shop.co.uk"],
    ["ministere.gouv.tg", "ministere.gouv.tg"],
    ["hotel.co.ci", "hotel.co.ci"],
    ["mybiz.wixsite.com", "mybiz.wixsite.com"],
    ["a.mybiz.wixsite.com", "mybiz.wixsite.com"],
    ["HOTEL.TG.", "hotel.tg"],
    ["127.0.0.1", "127.0.0.1"],
  ])("%s → %s", (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});
