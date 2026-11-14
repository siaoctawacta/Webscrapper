import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_ADDRESS_MESSAGE, type HostResolver } from "./ip-guard";
import { MAX_HTML_BYTES, enrichWebsite, parseWebsiteUrl, type EnrichDeps, type EnrichOptions } from "./index";
import { encodeCfEmail, localResolver, startTestServer, type TestServer } from "./test-server";

/**
 * End-to-end crawler tests against a local HTTP server. Every host name resolves to 127.0.0.1
 * (`localResolver`) and `allowPrivateNetwork` lets the crawler connect to it; the SSRF rules that
 * production applies are exercised separately with an injected resolver/fetch below.
 */

const SITE = "www.hotel-benin.tg";
const NOW = new Date("2026-06-01T10:00:00.000Z");
const UA = "LeadFinderBot/1.0 (+http://localhost:3000/bot)";
const mxOk = async () => ["mx1.mail.tg"];

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function crawl(url: string, opts: EnrichOptions = {}, deps: EnrichDeps = {}) {
  return enrichWebsite(
    url,
    { allowPrivateNetwork: true, resolveMx: mxOk, timeoutMs: 3000, maxPages: 3, ...opts },
    { resolver: localResolver, politenessDelayMs: 0, now: () => NOW, ...deps },
  );
}

const page = (body: string, head = "") => `<!doctype html><html lang="fr"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
/** Request paths the server saw, without the host. */
const paths = (s: TestServer) => s.hits.map((h) => h.slice(h.indexOf(" ") + 1));

describe("enrichWebsite — homepage extraction", () => {
  it("finds published emails (mailto, text, Cloudflare, [at]), socials, phones and site signals", async () => {
    server = await startTestServer({
      "/": {
        body: page(
          `<header>
             <a href="https://www.facebook.com/sharer/sharer.php?u=https://hotel-benin.tg">Partager</a>
             <a href="https://www.facebook.com/HotelLeBenin/">Facebook</a>
             <a href="https://www.instagram.com/hotel_le_benin/">Instagram</a>
             <a href="https://www.linkedin.com/company/hotel-le-benin/">LinkedIn</a>
             <a href="https://twitter.com/intent/tweet?text=Bonjour">Tweeter</a>
             <a href="https://twitter.com/HotelBenin">X</a>
             <a href="https://www.tiktok.com/@hotel.benin">TikTok</a>
             <a href="https://www.youtube.com/@HotelBenin">YouTube</a>
             <a href="https://api.whatsapp.com/send?phone=22890000000&text=Bonjour">WhatsApp</a>
           </header>
           <main>
             <a href="mailto:Reservation@Hotel-Benin.tg?subject=R%C3%A9servation">Réserver</a>
             <p>Écrivez-nous : info@hotel-benin.tg</p>
             <p><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encodeCfEmail("booking@hotel-benin.tg")}">[email&#160;protected]</a></p>
             <p>Direction : direction [at] hotel-benin [dot] tg</p>
             <p>Gmail : hotelbenin@gmail.com</p>
             <a href="tel:+228 22 21 00 00">Appeler</a> <a href="tel:+22822210000">Appeler</a> <a href="tel:+228%2090%2011%2022%2033">Mobile</a>
           </main>
           <footer>© 2017 Hôtel Le Bénin. Tous droits réservés.</footer>`,
          `<meta name="viewport" content="width=device-width, initial-scale=1"><title>  Hôtel Le Bénin — Lomé  </title>`,
        ),
      },
    });
    const r = await crawl(server.url("/", SITE));

    expect(r.websiteStatus).toBe("present");
    const home = server.url("/", SITE);
    expect(r.emails).toEqual([
      { email: "reservation@hotel-benin.tg", sourceUrl: home, sameDomain: true },
      { email: "booking@hotel-benin.tg", sourceUrl: home, sameDomain: true },
      { email: "info@hotel-benin.tg", sourceUrl: home, sameDomain: true },
      { email: "direction@hotel-benin.tg", sourceUrl: home, sameDomain: true },
      { email: "hotelbenin@gmail.com", sourceUrl: home, sameDomain: false },
    ]);
    expect(r.socials).toEqual({
      facebook: "https://www.facebook.com/HotelLeBenin",
      instagram: "https://www.instagram.com/hotel_le_benin",
      linkedin: "https://www.linkedin.com/company/hotel-le-benin",
      x: "https://x.com/HotelBenin",
      tiktok: "https://www.tiktok.com/@hotel.benin",
      youtube: "https://www.youtube.com/@HotelBenin",
      whatsapp: "https://wa.me/22890000000",
    });
    expect(r.phones).toEqual(["+228 22 21 00 00", "+228 90 11 22 33"]);
    expect(r.mx).toEqual({ "hotel-benin.tg": true, "gmail.com": true });
    expect(r.websiteCheck).toMatchObject({
      status: "ok",
      finalUrl: home,
      httpStatus: 200,
      https: false,
      mobileViewport: true,
      title: "Hôtel Le Bénin — Lomé",
      copyrightYear: 2017,
      pagesVisited: 1,
      checkedAt: NOW.toISOString(),
    });
    expect(r.websiteCheck.loadMs).toEqual(expect.any(Number));
    expect(r.websiteCheck.error).toBeUndefined();
  });

  it("identifies itself (User-Agent, Accept-Language) and reads robots.txt first", async () => {
    server = await startTestServer({ "/": { body: page("<p>Bonjour</p>") } });
    await crawl(server.url("/", SITE));
    expect(paths(server)).toEqual(["/robots.txt", "/"]);
    for (const h of server.requests) {
      expect(h["user-agent"]).toBe(UA);
      expect(h["accept-language"]).toBe("fr,en;q=0.8");
    }
    await crawl(server.url("/", SITE), { userAgent: "CustomBot/2.0" });
    expect(server.requests.at(-1)?.["user-agent"]).toBe("CustomBot/2.0");
  });

  it("drops junk: asset names, placeholders, vendor/tracking ids, script contents", async () => {
    server = await startTestServer({
      "/": {
        body: page(
          `<img src="/img/logo@2x.png" alt="logo@2x.png">
           <p>Exemple : john.doe@example.com · you@domain.com · contact@email.com · yourname@hotel-benin.tg · name@hotel-benin.tg</p>
           <p>user@hotel-benin.tg test@hotel-benin.tg 605a7baede844d278b89dc95ae0a9123@sentry.wixpress.com support@godaddy.com</p>
           <p>jquery@3.6.0 bootstrap@5.3.2.min.js icon@3x.webp style@site.css</p>
           <p>Vrai contact : accueil@hotel-benin.tg</p>
           <script>var dsn = "abc@o123.ingest.sentry.io"; var x = "hidden@hotel-benin.tg";</script>`,
        ),
      },
    });
    const r = await crawl(server.url("/", SITE));
    expect(r.emails.map((e) => e.email)).toEqual(["accueil@hotel-benin.tg"]);
  });

  it("ranks addresses on the site's own domain first, keeps at most 5", async () => {
    server = await startTestServer({
      "/": {
        body: page(
          `<p>agence@webdesign-lome.com</p><p>hotelbenin@gmail.com</p><p>hotelbenin@yahoo.fr</p><p>a@partner-one.com</p>
           <p>b@partner-two.com</p><p>reservation@hotel-benin.tg</p><p>info@mail.hotel-benin.tg</p>`,
        ),
      },
    });
    const r = await crawl(server.url("/", SITE));
    expect(r.emails.map((e) => [e.email, e.sameDomain])).toEqual([
      ["reservation@hotel-benin.tg", true],
      ["info@mail.hotel-benin.tg", true],
      ["agence@webdesign-lome.com", false],
      ["hotelbenin@gmail.com", false],
      ["hotelbenin@yahoo.fr", false],
    ]);
  });

  it("decodes a latin1 (ISO-8859-1) page declared in Content-Type", async () => {
    const html = page("<h1>Hôtel Électricité à Lomé</h1><p>Écrivez à réception : reception@hotel-benin.tg</p><footer>© 2019 Hôtel</footer>", "<title>Hôtel Électricité</title>").replace(
      '<meta charset="utf-8">',
      "",
    );
    server = await startTestServer({ "/": { headers: { "content-type": "text/html; charset=ISO-8859-1" }, body: Buffer.from(html, "latin1") } });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteCheck.title).toBe("Hôtel Électricité");
    expect(r.websiteCheck.copyrightYear).toBe(2019);
    expect(r.emails.map((e) => e.email)).toEqual(["reception@hotel-benin.tg"]);
  });

  it("decodes a windows-1252 page declared only in <meta>", async () => {
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>Café du Port \x96 Menu à 5 \x80</title></head><body>© 2021</body></html>`;
    server = await startTestServer({ "/": { headers: { "content-type": "text/html" }, body: Buffer.from(html, "latin1") } });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteCheck.title).toBe("Café du Port – Menu à 5 €");
  });

  it("decompresses a gzip homepage", async () => {
    server = await startTestServer({
      "/": { headers: { "content-encoding": "gzip" }, body: zlib.gzipSync(Buffer.from(page("<p>contact@hotel-benin.tg</p>", "<title>Compressé</title>"))) },
    });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteCheck.title).toBe("Compressé");
    expect(r.emails.map((e) => e.email)).toEqual(["contact@hotel-benin.tg"]);
  });

  it(`reads at most ${MAX_HTML_BYTES} bytes of a page`, async () => {
    const filler = `<p>${"Chambres climatisées, piscine et restaurant. ".repeat(Math.ceil((MAX_HTML_BYTES + 200_000) / 46))}</p>`;
    const html = page(`<p>first@hotel-benin.tg</p>${filler}<p>late@hotel-benin.tg</p><footer>© 2024</footer>`);
    expect(Buffer.byteLength(html)).toBeGreaterThan(MAX_HTML_BYTES + 100_000);
    server = await startTestServer({ "/": { body: html } });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteCheck.status).toBe("ok");
    expect(r.emails.map((e) => e.email)).toEqual(["first@hotel-benin.tg"]);
    expect(r.websiteCheck.copyrightYear).toBeUndefined();
  });
});

describe("enrichWebsite — contact/about pages", () => {
  const home = page(
    `<nav><a href="/a-propos">À propos</a> <a href="/services">Nos services</a> <a href="/fr/nous-contacter/">Nous contacter</a>
     <a href="https://www.booking.com/hotel/tg/contact.html">Contact (Booking)</a> <a href="/brochure-contact.pdf">Brochure</a></nav>
     <p>hotelbenin@gmail.com</p><footer>© 2016</footer>`,
    "<title>Accueil</title>",
  );

  it("visits contact pages first, then about pages, and records where each address was found", async () => {
    server = await startTestServer({
      "/": { body: home },
      "/fr/nous-contacter/": {
        body: page(`<p>contact@hotel-benin.tg</p><p>hotelbenin@gmail.com</p><a href="https://wa.me/22891112233">WhatsApp</a><a href="tel:+22891112233">Tel</a>`),
      },
      "/a-propos": { body: page(`<p>direction (at) hotel-benin (dot) tg</p><footer>Copyright 2018-2024</footer>`) },
      "/services": { body: page("<p>services@hotel-benin.tg</p>") },
    });
    const r = await crawl(server.url("/", SITE));
    expect(paths(server)).toEqual(["/robots.txt", "/", "/fr/nous-contacter/", "/a-propos"]);
    expect(r.emails).toEqual([
      { email: "contact@hotel-benin.tg", sourceUrl: server.url("/fr/nous-contacter/", SITE), sameDomain: true },
      { email: "direction@hotel-benin.tg", sourceUrl: server.url("/a-propos", SITE), sameDomain: true },
      { email: "hotelbenin@gmail.com", sourceUrl: server.url("/", SITE), sameDomain: false },
    ]);
    expect(r.socials).toEqual({ whatsapp: "https://wa.me/22891112233" });
    expect(r.phones).toEqual(["+22891112233"]);
    expect(r.websiteCheck).toMatchObject({ status: "ok", pagesVisited: 3, title: "Accueil", copyrightYear: 2024 });
  });

  it("respects maxPages (homepage included)", async () => {
    server = await startTestServer({
      "/": { body: home },
      "/fr/nous-contacter/": { body: page("<p>contact@hotel-benin.tg</p>") },
      "/a-propos": { body: page("<p>direction@hotel-benin.tg</p>") },
    });
    const two = await crawl(server.url("/", SITE), { maxPages: 2 });
    expect(two.websiteCheck.pagesVisited).toBe(2);
    expect(two.emails.map((e) => e.email)).toEqual(["contact@hotel-benin.tg", "hotelbenin@gmail.com"]);
    const one = await crawl(server.url("/", SITE), { maxPages: 1 });
    expect(one.websiteCheck.pagesVisited).toBe(1);
  });

  it("skips sub-pages that robots.txt disallows", async () => {
    server = await startTestServer({
      "/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /fr/\n" },
      "/": { body: home },
      "/fr/nous-contacter/": { body: page("<p>contact@hotel-benin.tg</p>") },
      "/a-propos": { body: page("<p>direction@hotel-benin.tg</p>") },
    });
    const r = await crawl(server.url("/", SITE));
    expect(paths(server)).toEqual(["/robots.txt", "/", "/a-propos"]);
    expect(r.emails.map((e) => e.email)).toEqual(["direction@hotel-benin.tg", "hotelbenin@gmail.com"]);
  });

  it("ignores non-HTML, broken and off-site sub-pages", async () => {
    server = await startTestServer({
      "/": { body: page(`<a href="/contact">Contact</a><a href="/kontakt">Kontakt</a><a href="/about">About</a><p>Hôtel</p>`) },
      "/contact": { headers: { "content-type": "application/json" }, body: '{"email":"json@hotel-benin.tg"}' },
      "/about": { status: 500, body: page("<p>oops@hotel-benin.tg</p>") },
      // An off-site form provider, served by the same local server under another host name.
      "forms.other-site.com/form": { body: page("<p>leads@other-site.com</p>") },
    });
    server.setRoute("/kontakt", { status: 302, headers: { location: server.url("/form", "forms.other-site.com") } });
    const r = await crawl(server.url("/", SITE), { maxPages: 4 });
    expect(paths(server)).toEqual(["/robots.txt", "/", "/contact", "/kontakt", "/robots.txt", "/form", "/about"]);
    expect(r.emails).toEqual([]);
    expect(r.websiteCheck).toMatchObject({ status: "ok", pagesVisited: 4 });
  });

  it("waits between two pages of the same site", async () => {
    server = await startTestServer({
      "/": { body: home },
      "/fr/nous-contacter/": { body: page("<p>contact@hotel-benin.tg</p>") },
      "/a-propos": { body: page("<p>direction@hotel-benin.tg</p>") },
    });
    const t0 = Date.now();
    await crawl(server.url("/", SITE), {}, { politenessDelayMs: 150 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
  });
});

describe("enrichWebsite — robots.txt", () => {
  it.each([
    ["our bot", "User-agent: LeadFinderBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n"],
    ["every bot", "User-agent: *\nDisallow: /\n"],
  ])("does not fetch the homepage when robots.txt disallows it for %s", async (_label, rules) => {
    server = await startTestServer({ "/robots.txt": { headers: { "content-type": "text/plain" }, body: rules }, "/": { body: page("<p>info@hotel-benin.tg</p>") } });
    const r = await crawl(server.url("/", SITE));
    expect(paths(server)).toEqual(["/robots.txt"]);
    expect(r.websiteStatus).toBe("present");
    expect(r.websiteCheck).toMatchObject({ status: "blocked_by_robots", pagesVisited: 0, error: "robots.txt asks crawlers not to visit this page" });
    expect(r.emails).toEqual([]);
  });

  it("treats a robots.txt server error (5xx) as 'do not crawl'", async () => {
    server = await startTestServer({ "/robots.txt": { status: 503, body: "busy" }, "/": { body: page("<p>info@hotel-benin.tg</p>") } });
    const r = await crawl(server.url("/", SITE));
    expect(paths(server)).toEqual(["/robots.txt"]);
    expect(r.websiteCheck.status).toBe("blocked_by_robots");
    expect(r.websiteCheck.error).toMatch(/server error 503/);
  });

  it("crawls normally when robots.txt is missing (4xx)", async () => {
    server = await startTestServer({ "/robots.txt": { status: 404 }, "/": { body: page("<p>info@hotel-benin.tg</p>") } });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteCheck.status).toBe("ok");
    expect(r.emails.map((e) => e.email)).toEqual(["info@hotel-benin.tg"]);
  });

  it("checks robots.txt of the redirect target before following a homepage redirect", async () => {
    server = await startTestServer({
      "/": { status: 301, headers: { location: "/members/" } },
      "/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /members/\n" },
      "/members/": { body: page("<p>info@hotel-benin.tg</p>") },
    });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteCheck.status).toBe("blocked_by_robots");
    expect(paths(server)).toEqual(["/robots.txt", "/"]);
  });
});

describe("enrichWebsite — redirects", () => {
  it("follows a redirect chain (http → www → language page) and reports the final URL", async () => {
    server = await startTestServer({
      "/": { status: 301, headers: { location: "/fr" } },
      "/fr": (_req, res) => {
        res.writeHead(302, { location: server!.url("/fr/accueil", SITE) });
        res.end();
      },
      "/fr/accueil": { body: page(`<a href="contact">Contact</a>`, "<title>Accueil</title>") },
      "/fr/contact": { body: page("<p>contact@hotel-benin.tg</p>") },
    });
    const r = await crawl(server.url("/", "hotel-benin.tg"));
    expect(r.websiteCheck).toMatchObject({ status: "ok", finalUrl: server.url("/fr/accueil", SITE), httpStatus: 200, pagesVisited: 2 });
    expect(r.emails).toEqual([{ email: "contact@hotel-benin.tg", sourceUrl: server.url("/fr/contact", SITE), sameDomain: true }]);
  });

  it("gives up after 5 redirects", async () => {
    server = await startTestServer({});
    let n = 0;
    server.setRoute("/", (_req, res) => {
      res.writeHead(302, { location: `/?hop=${++n}` });
      res.end();
    });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteStatus).toBe("unreachable");
    expect(r.websiteCheck).toMatchObject({ status: "error", error: "Too many redirects (more than 5)" });
  });
});

describe("enrichWebsite — site problems never throw", () => {
  it("reports a timeout as unreachable", async () => {
    server = await startTestServer({ "/": { delayMs: 2000, body: page("<p>late</p>") } });
    const t0 = Date.now();
    const r = await crawl(server.url("/", SITE), { timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(1800);
    expect(r.websiteStatus).toBe("unreachable");
    expect(r.websiteCheck).toMatchObject({ status: "unreachable", error: "No response within 0.3 s", pagesVisited: 0 });
  });

  it("reports DNS failures and refused connections as unreachable", async () => {
    const nxdomain: HostResolver = async (host) => {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    };
    const dns = await crawl("http://no-such-hotel.tg/", {}, { resolver: nxdomain });
    expect(dns.websiteStatus).toBe("unreachable");
    expect(dns.websiteCheck).toMatchObject({ status: "unreachable", error: "Domain name not found (DNS lookup failed)" });

    server = await startTestServer({});
    const port = server.port;
    await server.close();
    server = undefined;
    const refused = await crawl(`http://${SITE}:${port}/`);
    expect(refused.websiteCheck).toMatchObject({ status: "unreachable", error: "Connection refused by the server" });
  });

  it.each([
    [404, "error", "unreachable", "The homepage was not found (HTTP 404)"],
    [500, "error", "unreachable", "The website returned a server error (HTTP 500)"],
    [403, "ok", "present", "The website refused our visit (HTTP 403)"],
  ] as const)("homepage HTTP %i → check %s / website %s", async (status, check, website, error) => {
    server = await startTestServer({ "/": { status, body: page("<p>info@hotel-benin.tg</p>") } });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteStatus).toBe(website);
    expect(r.websiteCheck).toMatchObject({ status: check, httpStatus: status, error, pagesVisited: 1 });
    expect(r.emails).toEqual([]);
  });

  it("ignores a homepage that is not HTML", async () => {
    server = await startTestServer({ "/": { headers: { "content-type": "application/pdf" }, body: Buffer.from("%PDF-1.4 contact@hotel-benin.tg") } });
    const r = await crawl(server.url("/", SITE));
    expect(r.websiteStatus).toBe("present");
    expect(r.websiteCheck).toMatchObject({ status: "ok", error: "The homepage is not a web page (application/pdf)" });
    expect(r.emails).toEqual([]);
  });

  it("sniffs an HTML homepage served without a Content-Type", async () => {
    server = await startTestServer({
      "/": (_req, res) => {
        res.writeHead(200);
        res.end("<!DOCTYPE html><html><body><p>info@hotel-benin.tg</p></body></html>");
      },
    });
    const r = await crawl(server.url("/", SITE));
    expect(r.emails.map((e) => e.email)).toEqual(["info@hotel-benin.tg"]);
  });

  it("skips addresses that are not websites, and cancelled visits", async () => {
    for (const bad of ["", "javascript:alert(1)", "mailto:info@hotel.tg", "ftp://hotel.tg/"]) {
      const r = await crawl(bad);
      expect(r.websiteStatus).toBe("unknown");
      expect(r.websiteCheck).toMatchObject({ status: "skipped", error: "Not a website address we can visit" });
    }
    const ac = new AbortController();
    ac.abort();
    const cancelled = await crawl("http://hotel-benin.tg/", { signal: ac.signal });
    expect(cancelled.websiteCheck).toMatchObject({ status: "skipped", error: "Cancelled" });
  });
});

describe("enrichWebsite — MX check", () => {
  it("maps the domains of found emails (max 3) to whether they have a mail server", async () => {
    server = await startTestServer({
      "/": { body: page("<p>info@hotel-benin.tg</p><p>contact@nomx.tg</p><p>a@flaky.tg</p><p>b@gone.tg</p><p>c@hotel-benin.tg</p>") },
    });
    const resolveMx = vi.fn(async (domain: string) => {
      if (domain === "hotel-benin.tg") return ["mx1.hotel-benin.tg"];
      if (domain === "nomx.tg") return [];
      if (domain === "gone.tg") throw Object.assign(new Error("queryMx ENOTFOUND"), { code: "ENOTFOUND" });
      throw Object.assign(new Error("queryMx ESERVFAIL"), { code: "ESERVFAIL" });
    });
    const r = await crawl(server.url("/", SITE), { resolveMx });
    expect(r.emails.map((e) => e.email)).toEqual(["info@hotel-benin.tg", "c@hotel-benin.tg", "contact@nomx.tg", "a@flaky.tg", "b@gone.tg"]);
    expect(resolveMx.mock.calls.map((c) => c[0])).toEqual(["hotel-benin.tg", "nomx.tg", "flaky.tg"]);
    expect(r.mx).toEqual({ "hotel-benin.tg": true, "nomx.tg": false });
  });

  it("does not look anything up when no email was found", async () => {
    server = await startTestServer({ "/": { body: page("<p>Pas d'email ici</p>") } });
    const resolveMx = vi.fn(mxOk);
    const r = await crawl(server.url("/", SITE), { resolveMx });
    expect(r.mx).toEqual({});
    expect(resolveMx).not.toHaveBeenCalled();
  });
});

describe("enrichWebsite — SSRF protection (production rules)", () => {
  const addresses: Record<string, string> = {
    "hotel.tg": "93.184.216.34",
    "www.hotel.tg": "93.184.216.34",
    "hotel-new.com": "151.101.1.1",
    "evil.tg": "10.0.0.7",
    "metadata.tg": "169.254.169.254",
  };
  const publicResolver: HostResolver = async (host) => {
    const a = addresses[host];
    if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return [{ address: a, family: 4 }];
  };
  const html = (body: string) => new Response(page(body), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  function fakeWeb(routes: Record<string, () => Response>) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return routes[url]?.() ?? new Response("not found", { status: 404 });
    });
    return { calls, fetch: fetchImpl as unknown as typeof fetch };
  }
  const production = (url: string, web: { fetch: typeof fetch }) =>
    enrichWebsite(url, { allowPrivateNetwork: false, fetch: web.fetch, resolveMx: mxOk, timeoutMs: 2000 }, { resolver: publicResolver, politenessDelayMs: 0, now: () => NOW });

  it("follows a redirect to a different public host", async () => {
    const web = fakeWeb({
      "http://hotel.tg/": () => redirect("https://hotel-new.com/fr/"),
      "https://hotel-new.com/fr/": () => html("<p>reservation@hotel-new.com</p>"),
    });
    const r = await production("http://hotel.tg/", web);
    expect(r.websiteCheck).toMatchObject({ status: "ok", finalUrl: "https://hotel-new.com/fr/", https: true });
    expect(r.emails).toEqual([{ email: "reservation@hotel-new.com", sourceUrl: "https://hotel-new.com/fr/", sameDomain: true }]);
    expect(web.calls).toEqual(["http://hotel.tg/robots.txt", "http://hotel.tg/", "https://hotel-new.com/robots.txt", "https://hotel-new.com/fr/"]);
  });

  it.each([
    ["a host resolving to a private IP", "http://evil.tg/"],
    ["a host resolving to the cloud metadata address", "http://metadata.tg/latest/meta-data/"],
    ["a literal loopback IP", "http://127.0.0.1/admin"],
    ["a literal IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/"],
  ])("refuses a redirect to %s without requesting it", async (_label, target) => {
    const web = fakeWeb({ "http://hotel.tg/": () => redirect(target) });
    const r = await production("http://hotel.tg/", web);
    expect(r.websiteStatus).toBe("unreachable");
    expect(r.websiteCheck).toMatchObject({ status: "error", error: BLOCKED_ADDRESS_MESSAGE });
    expect(web.calls).toEqual(["http://hotel.tg/robots.txt", "http://hotel.tg/"]);
  });

  it.each(["http://169.254.169.254/", "http://10.0.0.1/", "http://[fd00::1]/", "http://localhost/", "http://evil.tg/"])("never contacts %s", async (url) => {
    const web = fakeWeb({});
    const r = await production(url, web);
    expect(r.websiteCheck).toMatchObject({ status: "error", error: BLOCKED_ADDRESS_MESSAGE, pagesVisited: 0 });
    expect(web.calls).toEqual([]);
  });

  it("refuses non-standard ports", async () => {
    const web = fakeWeb({});
    const r = await production("http://hotel.tg:8080/", web);
    expect(r.websiteCheck).toMatchObject({ status: "error", error: "Only standard web ports (80 and 443) are visited" });
    expect(web.calls).toEqual([]);
  });

  it("with the real transport, refuses a host whose DNS answer is 127.0.0.1", async () => {
    server = await startTestServer({ "/": { body: page("<p>secret@intranet.tg</p>") } });
    const r = await enrichWebsite("http://intranet.tg/", { resolveMx: mxOk, timeoutMs: 2000 }, { resolver: localResolver, politenessDelayMs: 0 });
    expect(r.websiteCheck).toMatchObject({ status: "error", error: BLOCKED_ADDRESS_MESSAGE });
    expect(server.hits).toEqual([]);
  });
});

describe("parseWebsiteUrl", () => {
  it.each([
    ["https://www.hotel.tg/fr#top", "https://www.hotel.tg/fr"],
    ["www.hotel.tg", "http://www.hotel.tg/"],
    ["  hotel.tg/contact ", "http://hotel.tg/contact"],
    ["HTTP://Hotel.TG", "http://hotel.tg/"],
  ])("%j → %s", (raw, href) => {
    expect(parseWebsiteUrl(raw)?.href).toBe(href);
  });

  it.each(["", "   ", "javascript:alert(1)", "mailto:a@b.tg", "ftp://hotel.tg", "data:text/html,hi", "http://", `https://hotel.tg/${"a".repeat(2100)}`])("rejects %j", (raw) => {
    expect(parseWebsiteUrl(raw)).toBeNull();
  });
});
