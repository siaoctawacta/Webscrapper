import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrawlError } from "./errors";
import { createSafeHttpClient, parseContentType, type GetOptions, type SafeClientConfig } from "./http-client";
import type { HostResolver } from "./ip-guard";
import { localResolver, startTestServer, type TestServer } from "./test-server";

const UA = "LeadFinderBot/1.0 (+http://localhost:3000/bot)";
const base: GetOptions = { timeoutMs: 2000, maxBytes: 1024 * 1024, accept: "text/html" };
const local = (extra: Partial<SafeClientConfig> = {}) =>
  createSafeHttpClient({ allowPrivateNetwork: true, userAgent: UA, acceptLanguage: "fr,en;q=0.8", resolver: localResolver, ...extra });

async function rejection(p: Promise<unknown>): Promise<CrawlError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CrawlError);
    return e as CrawlError;
  }
  throw new Error("expected the request to fail");
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("parseContentType", () => {
  it("splits MIME type and charset", () => {
    expect(parseContentType("Text/HTML; Charset=ISO-8859-1")).toEqual({ mimeType: "text/html", charset: "ISO-8859-1" });
    expect(parseContentType('application/xhtml+xml;charset="utf-8"')).toEqual({ mimeType: "application/xhtml+xml", charset: "utf-8" });
    expect(parseContentType(undefined)).toEqual({ mimeType: null, charset: null });
  });
});

describe("safe client over node:http (local server)", () => {
  it("sends the bot identity headers", async () => {
    server = await startTestServer({ "/": { body: "<p>ok</p>" } });
    const res = await local().get(new URL(server.url("/")), base);
    expect(res.status).toBe(200);
    expect(res.body?.toString()).toBe("<p>ok</p>");
    expect(server.requests[0]?.["user-agent"]).toBe(UA);
    expect(server.requests[0]?.["accept-language"]).toBe("fr,en;q=0.8");
    expect(server.requests[0]?.["accept-encoding"]).toBe("gzip, deflate, br");
  });

  it.each([
    ["gzip", (b: Buffer) => zlib.gzipSync(b)],
    ["deflate", (b: Buffer) => zlib.deflateSync(b)],
    ["deflate", (b: Buffer) => zlib.deflateRawSync(b)],
    ["br", (b: Buffer) => zlib.brotliCompressSync(b)],
  ])("decompresses %s", async (encoding, compress) => {
    const html = `<p>${"Hôtel Lomé ".repeat(2000)}</p>`;
    server = await startTestServer({ "/": { headers: { "content-encoding": encoding }, body: compress(Buffer.from(html)) } });
    const res = await local().get(new URL(server.url("/")), base);
    expect(res.body?.toString("utf8")).toBe(html);
    expect(res.truncated).toBe(false);
  });

  it("caps the decompressed size (compression bomb)", async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(50 * 1024 * 1024, 0x20)); // 50 MB of spaces, ~50 KB on the wire
    server = await startTestServer({ "/": { headers: { "content-encoding": "gzip" }, body: bomb } });
    const res = await local().get(new URL(server.url("/")), { ...base, maxBytes: 100_000 });
    expect(res.body?.length).toBe(100_000);
    expect(res.truncated).toBe(true);
  });

  it("refuses an unknown content encoding", async () => {
    server = await startTestServer({ "/": { headers: { "content-encoding": "zstd-ish" }, body: "x" } });
    const e = await rejection(local().get(new URL(server.url("/")), base));
    expect(e.kind).toBe("protocol");
  });

  it("does not download bodies it does not want", async () => {
    server = await startTestServer({ "/file.pdf": { headers: { "content-type": "application/pdf" }, body: Buffer.alloc(5 * 1024 * 1024) } });
    const res = await local().get(new URL(server.url("/file.pdf")), { ...base, shouldReadBody: (_s, mime) => mime === "text/html" });
    expect(res.mimeType).toBe("application/pdf");
    expect(res.body).toBeNull();
  });

  it("follows redirects (relative, absolute, cross-host) and reports every hop", async () => {
    server = await startTestServer({
      "/": { status: 301, headers: { location: "/home" } },
      "/home": (req, res) => {
        res.writeHead(302, { location: `http://www.hotel.test:${server!.port}/fr/` });
        res.end();
      },
      "/fr/": { body: "<p>Bienvenue</p>" },
    });
    const beforeRedirect = vi.fn(async () => {});
    const res = await local().get(new URL(server.url("/", "hotel.test")), { ...base, beforeRedirect });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`http://www.hotel.test:${server.port}/fr/`);
    expect(res.redirects).toEqual([`http://hotel.test:${server.port}/home`, `http://www.hotel.test:${server.port}/fr/`]);
    expect(beforeRedirect).toHaveBeenCalledTimes(2);
    expect(server.hits).toEqual([`hotel.test:${server.port} /`, `hotel.test:${server.port} /home`, `www.hotel.test:${server.port} /fr/`]);
  });

  it("stops after 5 redirects", async () => {
    let n = 0;
    server = await startTestServer({
      "/loop": (_req, res) => {
        n++;
        res.writeHead(302, { location: `/loop?n=${n}` });
        res.end();
      },
    });
    server.setRoute("/loop", (_req, res) => {
      n++;
      res.writeHead(302, { location: `/loop?n=${n}` });
      res.end();
    });
    const e = await rejection(local().get(new URL(server.url("/loop")), base));
    expect(e.kind).toBe("too_many_redirects");
    expect(n).toBe(6); // the original request + 5 followed hops
  });

  it("lets beforeRedirect veto a hop (robots)", async () => {
    server = await startTestServer({ "/": { status: 302, headers: { location: "/private" } }, "/private": { body: "secret" } });
    const e = await rejection(
      local().get(new URL(server.url("/")), {
        ...base,
        beforeRedirect: async (next) => {
          throw new CrawlError("robots", "robots.txt asks crawlers not to visit this page", next.href);
        },
      }),
    );
    expect(e.kind).toBe("robots");
    expect(server.hits).toHaveLength(1);
  });

  it("times out when the server never answers", async () => {
    server = await startTestServer({ "/": { delayMs: 3000, body: "late" } });
    const t0 = Date.now();
    const e = await rejection(local().get(new URL(server.url("/")), { ...base, timeoutMs: 300 }));
    expect(e.kind).toBe("timeout");
    expect(e.message).toBe("No response within 0.3 s");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("times out when the body stalls after the headers", async () => {
    server = await startTestServer({
      "/": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<p>start");
        // never ends
      },
    });
    const e = await rejection(local().get(new URL(server.url("/")), { ...base, timeoutMs: 300 }));
    expect(e.kind).toBe("timeout");
  });

  it("reports refused connections and DNS failures", async () => {
    server = await startTestServer({});
    const port = server.port;
    await server.close();
    server = undefined;
    const refused = await rejection(local().get(new URL(`http://127.0.0.1:${port}/`), base));
    expect(refused.kind).toBe("connect");
    expect(refused.message).toBe("Connection refused by the server");

    const nxdomain: HostResolver = async (host) => {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    };
    const dns = await rejection(local({ resolver: nxdomain }).get(new URL("http://no-such-hotel.test/"), base));
    expect(dns.kind).toBe("dns");
    expect(dns.message).toBe("Domain name not found (DNS lookup failed)");
  });

  it("honours the caller's abort signal", async () => {
    server = await startTestServer({ "/": { delayMs: 2000, body: "late" } });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const e = await rejection(local().get(new URL(server.url("/")), { ...base, signal: ac.signal }));
    expect(e.kind).toBe("aborted");
  });

  it("without allowPrivateNetwork, refuses to connect to a host that resolves to 127.0.0.1", async () => {
    server = await startTestServer({ "/": { body: "internal" } });
    const client = createSafeHttpClient({ allowPrivateNetwork: false, userAgent: UA, acceptLanguage: "fr", resolver: localResolver });
    // Port 80: the only way to get past the port rule; the lookup refuses before any connection.
    const e = await rejection(client.get(new URL("http://intranet.test/"), base));
    expect(e.kind).toBe("blocked_address");
    expect(server.hits).toEqual([]);
  });
});

describe("redirect re-validation (mocked transport + resolver, production rules)", () => {
  const addresses: Record<string, string> = {
    "shop.test": "93.184.216.34",
    "moved.test": "151.101.1.1",
    "evil.test": "10.0.0.7",
    "rebind.test": "169.254.169.254",
  };
  const resolver: HostResolver = async (host) => {
    const a = addresses[host];
    if (!a) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return [{ address: a, family: 4 }];
  };
  const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });
  const page = (html: string) => new Response(html, { status: 200, headers: { "content-type": "text/html" } });

  function client(routes: Record<string, () => Response>) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      const route = routes[url];
      return route ? route() : new Response("nf", { status: 404 });
    });
    return {
      calls,
      http: createSafeHttpClient({ allowPrivateNetwork: false, userAgent: UA, acceptLanguage: "fr", resolver, fetch: fetchImpl as unknown as typeof fetch }),
    };
  }

  it("follows a redirect to a different public host", async () => {
    const c = client({ "http://shop.test/": () => redirectTo("https://moved.test/fr/"), "https://moved.test/fr/": () => page("<p>ok</p>") });
    const res = await c.http.get(new URL("http://shop.test/"), base);
    expect(res.finalUrl).toBe("https://moved.test/fr/");
    expect(c.calls).toEqual(["http://shop.test/", "https://moved.test/fr/"]);
  });

  it("refuses a hop to a host that resolves to a private IP, before requesting it", async () => {
    const c = client({
      "http://shop.test/": () => redirectTo("http://moved.test/"),
      "http://moved.test/": () => redirectTo("http://evil.test/admin"),
      "http://evil.test/admin": () => page("<p>internal</p>"),
    });
    const e = await rejection(c.http.get(new URL("http://shop.test/"), base));
    expect(e.kind).toBe("blocked_address");
    expect(c.calls).toEqual(["http://shop.test/", "http://moved.test/"]);
  });

  it.each(["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://[::1]/", "http://rebind.test/", "http://shop.test:8080/", "file:///etc/passwd"])(
    "refuses a redirect to %s",
    async (target) => {
      const c = client({ "https://shop.test/": () => redirectTo(target) });
      const e = await rejection(c.http.get(new URL("https://shop.test/"), base));
      expect(["blocked_address", "blocked_port", "invalid_url"]).toContain(e.kind);
      expect(c.calls).toEqual(["https://shop.test/"]);
    },
  );

  it("refuses an HTTPS → HTTP redirect to another host but allows it on the same host", async () => {
    const c = client({
      "https://shop.test/": () => redirectTo("http://moved.test/"),
      "https://shop.test/a": () => redirectTo("http://shop.test/b"),
      "http://shop.test/b": () => page("<p>ok</p>"),
    });
    expect((await rejection(c.http.get(new URL("https://shop.test/"), base))).kind).toBe("bad_redirect");
    expect((await c.http.get(new URL("https://shop.test/a"), base)).finalUrl).toBe("http://shop.test/b");
  });

  it("caps bodies read through an injected fetch", async () => {
    const c = client({ "http://shop.test/": () => page("x".repeat(5000)) });
    const res = await c.http.get(new URL("http://shop.test/"), { ...base, maxBytes: 1000 });
    expect(res.body?.length).toBe(1000);
    expect(res.truncated).toBe(true);
  });
});
