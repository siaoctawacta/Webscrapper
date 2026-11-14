import { describe, expect, it } from "vitest";
import { charsetFromContentType, decodeHtml, metaCharset, resolveEncoding } from "./charset";
import { extractPage, findCopyrightYear, phoneFromTelHref } from "./extract";
import { matchKey, selectSubpages, subpagePriority } from "./links";
import { encodeCfEmail } from "./test-server";

const HOME = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="Viewport" content="width=device-width, initial-scale=1">
  <title>
    Hôtel Le Bénin — Lomé
  </title>
  <script>var support = "tracker@example.com"; document.write("x@y.zz")</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Hotel","email":"mailto:events@hotel-benin.tg","sameAs":["https://www.instagram.com/hotel_le_benin/"]}</script>
  <style>.a{background:url(logo@2x.png)}</style>
</head>
<body>
  <svg><title>icon</title></svg>
  <header><a href="https://www.facebook.com/sharer.php?u=x">Partager</a><a href="https://www.facebook.com/HotelLeBenin">Facebook</a></header>
  <p>Réservations</p><p>info@hotel-benin.tg</p>
  <a href="mailto:Reservation@Hotel-Benin.tg?subject=Bonjour">Écrivez-nous</a>
  <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encodeCfEmail("booking@hotel-benin.tg")}">[email&#160;protected]</a>
  <a href="/cdn-cgi/l/email-protection#${encodeCfEmail("sales@hotel-benin.tg", 0x21)}">Ventes</a>
  <p>Direction : direction [at] hotel-benin [dot] tg</p>
  <p>Gmail: hotelbenin@gmail.com — ou john.doe@example.com</p>
  <img src="/img/logo@2x.png" alt="logo@2x.png">
  <a href="tel:+228 22 21 00 00">Appelez</a> <a href="tel:+22822210000">Appelez</a> <a href="tel:12">x</a>
  <a href="https://twitter.com/intent/tweet?text=x">Tweet</a> <a href="https://twitter.com/HotelBenin">X</a>
  <a href="https://wa.me/22890000000">WhatsApp</a>
  <a href="/fr/nous-contacter/">Nous contacter</a>
  <a href="a-propos.html">À propos</a>
  <a href="/services">Nos services</a>
  <a href="#top">Haut</a>
  <footer>© 2017 - 2023 Hôtel Le Bénin. Tous droits réservés. Tél : 2290 1234</footer>
</body>
</html>`;

describe("extractPage", () => {
  const page = extractPage(HOME, "https://www.hotel-benin.tg/", { currentYear: 2026 });

  it("finds mailto, Cloudflare, JSON-LD, text and obfuscated emails; drops scripts, assets and placeholders", () => {
    expect(page.emails).toEqual([
      "reservation@hotel-benin.tg",
      "sales@hotel-benin.tg",
      "booking@hotel-benin.tg",
      "events@hotel-benin.tg",
      "info@hotel-benin.tg",
      "hotelbenin@gmail.com",
      "direction@hotel-benin.tg",
    ]);
  });

  it("collects canonical socials (share/intent links ignored, JSON-LD sameAs used)", () => {
    expect(page.socials).toEqual({
      facebook: "https://www.facebook.com/HotelLeBenin",
      x: "https://x.com/HotelBenin",
      whatsapp: "https://wa.me/22890000000",
      instagram: "https://www.instagram.com/hotel_le_benin",
    });
  });

  it("collects tel: links deduplicated by digits", () => {
    expect(page.phones).toEqual(["+228 22 21 00 00"]);
  });

  it("reads title, viewport and the latest copyright year", () => {
    expect(page.title).toBe("Hôtel Le Bénin — Lomé");
    expect(page.mobileViewport).toBe(true);
    expect(page.copyrightYear).toBe(2023);
  });

  it("returns absolute links without fragments, with their text", () => {
    expect(page.links).toContainEqual({ url: "https://www.hotel-benin.tg/fr/nous-contacter/", text: "Nous contacter" });
    expect(page.links).toContainEqual({ url: "https://www.hotel-benin.tg/a-propos.html", text: "À propos" });
    expect(page.links).toContainEqual({ url: "https://www.hotel-benin.tg/", text: "Haut" });
  });

  it("handles pages without viewport/title, honours <base href>, caps the title at 200 chars", () => {
    const long = "A".repeat(500);
    const p = extractPage(`<html><head><base href="https://cdn.hotel.tg/fr/"><title>${long}</title></head><body><a href="contact">Contact</a></body></html>`, "https://hotel.tg/");
    expect(p.mobileViewport).toBe(false);
    expect(p.title).toHaveLength(200);
    expect(p.links[0]?.url).toBe("https://cdn.hotel.tg/fr/contact");
    expect(extractPage("<p>nothing</p>", "https://hotel.tg/").title).toBeNull();
  });
});

describe("findCopyrightYear", () => {
  it.each([
    ["© 2017 Hôtel", 2017],
    ["Copyright ©2015-2024 Lodge", 2024],
    ["Copyright 2019 · All rights reserved", 2019],
    ["(c) 2021 Shop", 2021],
    ["&copy; 2016 Shop", 2016],
    ["Copyright © Hôtel Sarakawa 2018", 2018],
    ["© 2099 Future", null],
    ["© 1980 Old", null],
    ["Founded 2010\n© Hôtel", null],
    ["No marker 2020", null],
  ])("%j → %s", (text, year) => {
    expect(findCopyrightYear(text, 2026)).toBe(year);
  });
});

describe("phoneFromTelHref", () => {
  it("keeps the published number, rejects junk", () => {
    expect(phoneFromTelHref("tel:+228%2090%2000%2000%2000")).toBe("+228 90 00 00 00");
    expect(phoneFromTelHref("tel://0302123456")).toBe("0302123456");
    expect(phoneFromTelHref("tel:+233-30-212-3456;ext=12")).toBe("+233-30-212-3456");
    expect(phoneFromTelHref("tel:123")).toBeNull();
    expect(phoneFromTelHref("tel:call-us")).toBeNull();
  });
});

describe("subpage discovery", () => {
  it("normalizes accents and spaces for matching", () => {
    expect(matchKey("À propos")).toBe("a-propos");
    expect(matchKey("Qui sommes-nous ?")).toBe("qui-sommes-nous-?");
  });

  it("recognizes contact and about pages by href or text (EN/FR/DE)", () => {
    const p = (url: string, text = "") => subpagePriority({ url, text });
    expect(p("https://h.tg/contact")).toBe(0);
    expect(p("https://h.tg/contactez-nous")).toBe(0);
    expect(p("https://h.tg/page?id=7", "Nous contacter")).toBe(0);
    expect(p("https://h.tg/kontakt")).toBe(0);
    expect(p("https://h.tg/impressum")).toBe(0);
    expect(p("https://h.tg/%C3%A0-propos")).toBe(1);
    expect(p("https://h.tg/qui-sommes-nous")).toBe(1);
    expect(p("https://h.tg/x", "About us")).toBe(1);
    expect(p("https://h.tg/services", "Services")).toBeNull();
  });

  it("selects same-site pages, contact first, skipping the homepage, files and duplicates", () => {
    const links = [
      { url: "https://www.hotel.tg/a-propos", text: "À propos" },
      { url: "https://www.hotel.tg/", text: "Contact" }, // the homepage itself
      { url: "https://facebook.com/contact", text: "Contact" }, // other site
      { url: "https://www.hotel.tg/brochure-contact.pdf", text: "Contact PDF" },
      { url: "https://www.hotel.tg/contact/", text: "Contact" },
      { url: "https://hotel.tg/contact", text: "Contact" }, // same page without www / slash
      { url: "https://www.hotel.tg/impressum", text: "Impressum" },
      { url: "https://www.hotel.tg/services", text: "Services" },
    ];
    expect(selectSubpages(links, { homeUrls: ["https://hotel.tg/", "https://www.hotel.tg/"], siteHosts: ["hotel.tg", "www.hotel.tg"], limit: 2 })).toEqual([
      "https://www.hotel.tg/contact/",
      "https://www.hotel.tg/impressum",
    ]);
    expect(selectSubpages(links, { homeUrls: ["https://www.hotel.tg/"], siteHosts: ["www.hotel.tg"], limit: 0 })).toEqual([]);
  });
});

describe("charset decoding", () => {
  const latin1 = (s: string) => Buffer.from(s, "latin1");

  it("reads the charset parameter and meta declarations", () => {
    expect(charsetFromContentType('text/html; charset="ISO-8859-1"')).toBe("ISO-8859-1");
    expect(charsetFromContentType("text/html")).toBeNull();
    expect(metaCharset(latin1('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'))).toBe("windows-1252");
    expect(metaCharset(latin1("<meta charset='latin1'>"))).toBe("latin1");
    expect(resolveEncoding("latin1")).toBe("windows-1252");
    expect(resolveEncoding("utf-16")).toBe("utf-8");
    expect(resolveEncoding("klingon")).toBeNull();
  });

  it("decodes by header, then meta, then BOM, else UTF-8 with a windows-1252 fallback", () => {
    expect(decodeHtml(latin1("<p>Hôtel Électricité</p>"), "iso-8859-1")).toBe("<p>Hôtel Électricité</p>");
    expect(decodeHtml(latin1('<meta charset="windows-1252"><p>Café – 5 €</p>'.replace("–", "\x96").replace("€", "\x80")), null)).toContain("Café – 5 €");
    expect(decodeHtml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<p>Lomé</p>")]), "iso-8859-1")).toBe("<p>Lomé</p>");
    expect(decodeHtml(Buffer.from("<p>Lomé</p>"), null)).toBe("<p>Lomé</p>");
    expect(decodeHtml(latin1("<p>Lomé</p>"), null)).toBe("<p>Lomé</p>"); // undeclared, invalid UTF-8
    expect(decodeHtml(Buffer.from("<p>Lomé</p>"), "klingon")).toBe("<p>Lomé</p>");
  });

  it("does not fall back to windows-1252 when a capped UTF-8 body ends mid-character", () => {
    const full = Buffer.from("<p>Lomé é</p>");
    const cut = full.subarray(0, full.indexOf(Buffer.from("é é")) + 3); // "Lomé" + space + first byte of "é"
    expect(decodeHtml(cut, null)).toBe("<p>Lomé ");
  });
});
