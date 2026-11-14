import { afterEach, describe, expect, it } from "vitest";
import { CrawlError } from "./errors";
import { createSafeHttpClient, type FetchedResponse, type GetOptions, type SafeHttpClient } from "./http-client";
import { ROBOTS_MAX_BYTES, ROBOTS_TIMEOUT_MS, ROBOTS_UA, RobotsCache } from "./robots";
import { localResolver, startTestServer, type TestServer } from "./test-server";

/** A SafeHttpClient double that answers robots.txt requests from a table and records calls. */
function fakeClient(answer: (url: URL, opts: GetOptions) => FetchedResponse | Promise<FetchedResponse>) {
  const calls: { url: string; opts: GetOptions }[] = [];
  const client: SafeHttpClient = {
    async get(url, opts) {
      calls.push({ url: url.href, opts });
      return answer(url, opts);
    },
  };
  return { client, calls };
}

function response(url: URL, status: number, body = ""): FetchedResponse {
  return {
    requestedUrl: url.href,
    finalUrl: url.href,
    status,
    mimeType: "text/plain",
    charset: null,
    body: status >= 200 && status < 300 ? Buffer.from(body) : null,
    truncated: false,
    redirects: [],
    elapsedMs: 1,
  };
}

describe("RobotsCache (RFC 9309)", () => {
  it("applies the rules of the group for LeadFinderBot, else the * group", async () => {
    const { client } = fakeClient((u) =>
      response(
        u,
        200,
        ["User-agent: *", "Disallow: /", "", `User-agent: ${ROBOTS_UA}`, "Disallow: /admin", "Disallow: /contact-prive", "Allow: /"].join("\n"),
      ),
    );
    const robots = new RobotsCache(client);
    expect(await robots.check(new URL("https://hotel.tg/"))).toEqual({ allowed: true });
    expect(await robots.check(new URL("https://hotel.tg/contact"))).toEqual({ allowed: true });
    expect(await robots.check(new URL("https://hotel.tg/admin/login"))).toEqual({ allowed: false, reason: "robots.txt asks crawlers not to visit this page" });
    expect((await robots.check(new URL("https://hotel.tg/contact-prive"))).allowed).toBe(false);
  });

  it("falls back to the * group when there is no group for our bot", async () => {
    const { client } = fakeClient((u) => response(u, 200, "User-agent: OtherBot\nAllow: /\n\nUser-agent: *\nDisallow: /contact\n"));
    const robots = new RobotsCache(client);
    expect((await robots.check(new URL("https://hotel.tg/"))).allowed).toBe(true);
    expect((await robots.check(new URL("https://hotel.tg/contact"))).allowed).toBe(false);
  });

  it("fetches robots.txt once per origin, with the 5 s / 64 KB limits", async () => {
    const { client, calls } = fakeClient((u) => response(u, 200, "User-agent: *\nDisallow: /private\n"));
    const robots = new RobotsCache(client, { timeoutMs: 30_000 });
    await Promise.all([robots.check(new URL("https://hotel.tg/")), robots.check(new URL("https://hotel.tg/contact")), robots.check(new URL("https://hotel.tg/private"))]);
    await robots.check(new URL("https://www.hotel.tg/"));
    await robots.check(new URL("http://hotel.tg/"));
    expect(calls.map((c) => c.url)).toEqual(["https://hotel.tg/robots.txt", "https://www.hotel.tg/robots.txt", "http://hotel.tg/robots.txt"]);
    expect(calls[0]!.opts.timeoutMs).toBe(ROBOTS_TIMEOUT_MS);
    expect(calls[0]!.opts.maxBytes).toBe(ROBOTS_MAX_BYTES);
  });

  it("uses the shorter page timeout when it is below 5 s", async () => {
    const { client, calls } = fakeClient((u) => response(u, 404));
    await new RobotsCache(client, { timeoutMs: 800 }).check(new URL("https://hotel.tg/"));
    expect(calls[0]!.opts.timeoutMs).toBe(800);
  });

  it.each([400, 401, 403, 404, 410, 429])("treats HTTP %i as 'unavailable': everything allowed", async (status) => {
    const { client } = fakeClient((u) => response(u, status));
    const robots = new RobotsCache(client);
    expect(await robots.check(new URL("https://hotel.tg/contact"))).toEqual({ allowed: true });
  });

  it.each([500, 502, 503])("treats HTTP %i as 'unreachable': everything disallowed", async (status) => {
    const { client } = fakeClient((u) => response(u, status));
    const verdict = await new RobotsCache(client).check(new URL("https://hotel.tg/"));
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining(`server error ${status}`) });
  });

  it("reports network failures (nothing may be crawled) and keeps the error", async () => {
    const { client } = fakeClient(() => {
      throw new CrawlError("dns", "Domain name not found (DNS lookup failed)", "https://gone.tg/robots.txt");
    });
    const verdict = await new RobotsCache(client).check(new URL("https://gone.tg/"));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed || !("error" in verdict)) throw new Error("expected a failed verdict");
    expect(verdict.error.kind).toBe("dns");
  });

  it("allows everything after too many redirects (RFC 9309: unavailable)", async () => {
    const { client } = fakeClient(() => {
      throw new CrawlError("too_many_redirects", "Too many redirects (more than 5)");
    });
    expect(await new RobotsCache(client).check(new URL("https://hotel.tg/"))).toEqual({ allowed: true });
  });

  it("exposes a Crawl-delay for our bot", async () => {
    const { client } = fakeClient((u) =>
      u.hostname === "slow.tg" ? response(u, 200, "User-agent: *\nCrawl-delay: 2\nDisallow:\n") : response(u, 200, "User-agent: *\nDisallow:\n"),
    );
    const robots = new RobotsCache(client);
    expect(await robots.crawlDelaySeconds("https://slow.tg")).toBe(2);
    expect(await robots.crawlDelaySeconds("https://fast.tg")).toBeNull();
  });
});

describe("RobotsCache over the safe client (local server)", () => {
  let server: TestServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  const client = () =>
    createSafeHttpClient({ allowPrivateNetwork: true, userAgent: "LeadFinderBot/1.0 (+http://localhost:3000/bot)", acceptLanguage: "fr,en;q=0.8", resolver: localResolver });

  it("follows a robots.txt redirect and matches rules against the original origin", async () => {
    server = await startTestServer({
      "/robots.txt": { status: 301, headers: { location: "/static/robots.txt" } },
      "/static/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /prive\n" },
    });
    const robots = new RobotsCache(client());
    expect((await robots.check(new URL(server.url("/")))).allowed).toBe(true);
    expect((await robots.check(new URL(server.url("/prive/page")))).allowed).toBe(false);
  });

  it("reads only the first 64 KB of a huge robots.txt", async () => {
    const padding = "# padding line for the size cap\n".repeat(Math.ceil((ROBOTS_MAX_BYTES + 1024) / 32));
    server = await startTestServer({ "/robots.txt": { headers: { "content-type": "text/plain" }, body: `${padding}User-agent: *\nDisallow: /\n` } });
    // The Disallow lies beyond the cap, so it is never seen.
    expect((await new RobotsCache(client()).check(new URL(server.url("/contact")))).allowed).toBe(true);
  });
});
