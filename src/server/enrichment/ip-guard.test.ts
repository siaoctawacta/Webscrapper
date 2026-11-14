import http from "node:http";
import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import { CrawlError } from "./errors";
import { assertRedirectAllowed, assertUrlAllowed, classifyIp, createSafeLookup, isPublicIp, resolveAllowedAddresses, sameHost, type HostResolver } from "./ip-guard";
import { startTestServer } from "./test-server";

describe("classifyIp / isPublicIp", () => {
  const blockedV4: [string, string][] = [
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "linkLocal"],
    ["100.64.0.1", "carrierGradeNat"],
    ["100.127.255.255", "carrierGradeNat"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["255.255.255.255", "broadcast"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["192.0.2.10", "reserved"],
    ["198.51.100.7", "reserved"],
    ["203.0.113.5", "reserved"],
    ["198.18.0.1", "reserved"],
    ["240.0.0.1", "reserved"],
    ["192.0.0.8", "reserved"],
  ];
  it.each(blockedV4)("blocks IPv4 %s (%s)", (ip, range) => {
    expect(classifyIp(ip)).toBe(range);
    expect(isPublicIp(ip)).toBe(false);
  });

  const blockedV6: [string, string][] = [
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fc00::1", "uniqueLocal"],
    ["fd12:3456:789a::1", "uniqueLocal"],
    ["fe80::1", "linkLocal"],
    ["fe80::1%eth0", "linkLocal"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "reserved"],
    ["2002:7f00:1::1", "6to4"],
    ["2001:0:4136:e378::1", "teredo"],
    ["64:ff9b::a00:1", "rfc6052"],
    ["100::1", "discard"],
    ["::127.0.0.1", "nonGlobal"],
    ["fec0::1", "deprecatedSiteLocal"],
  ];
  it.each(blockedV6)("blocks IPv6 %s (%s)", (ip, range) => {
    expect(classifyIp(ip)).toBe(range);
    expect(isPublicIp(ip)).toBe(false);
  });

  const mapped: [string, string][] = [
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:192.168.0.1", "private"],
    ["::ffff:172.20.0.1", "private"],
    ["::ffff:169.254.169.254", "linkLocal"],
    ["::ffff:100.64.0.1", "carrierGradeNat"],
    ["::ffff:0.0.0.0", "unspecified"],
    ["[::ffff:127.0.0.1]", "loopback"],
  ];
  it.each(mapped)("judges IPv4-mapped %s by its IPv4 address (%s)", (ip, range) => {
    expect(classifyIp(ip)).toBe(range);
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "41.207.160.1", "196.10.10.10", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "2001:4860:4860::8888", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public unicast %s",
    (ip) => {
      expect(classifyIp(ip)).toBe("unicast");
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it.each(["", "not-an-ip", "1.2.3", "999.1.1.1", "example.com", "0x7f000001"])("treats %j as invalid (never public)", (ip) => {
    expect(classifyIp(ip)).toBe("invalid");
    expect(isPublicIp(ip)).toBe(false);
  });
});

describe("assertUrlAllowed", () => {
  const blocked = (url: string, kind: string) => {
    try {
      assertUrlAllowed(new URL(url), false);
    } catch (e) {
      expect(e).toBeInstanceOf(CrawlError);
      expect((e as CrawlError).kind).toBe(kind);
      return;
    }
    throw new Error(`expected ${url} to be blocked`);
  };

  it("accepts ordinary public web addresses", () => {
    for (const u of ["http://hotel.tg/", "https://www.hotel-benin.tg/contact", "http://hotel.tg:80/", "https://hotel.tg:443/", "http://8.8.8.8/", "http://[2001:4860:4860::8888]/"]) {
      expect(() => assertUrlAllowed(new URL(u), false)).not.toThrow();
    }
  });

  it("rejects other schemes and credentials", () => {
    blocked("ftp://hotel.tg/", "invalid_url");
    blocked("file:///etc/passwd", "invalid_url");
    blocked("http://user:secret@hotel.tg/", "invalid_url");
  });

  it("rejects non-standard ports", () => {
    blocked("http://hotel.tg:8080/", "blocked_port");
    blocked("https://hotel.tg:22/", "blocked_port");
  });

  it("rejects literal private / loopback / metadata IPs, in every spelling the URL parser normalizes", () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      "http://2130706433/", // 127.0.0.1 as a single number
      "http://0x7f.1/", // 127.0.0.1 in hex shorthand
      "http://0177.0.0.1/", // octal
      "http://0/",
      "http://localhost/",
      "http://app.localhost/",
    ]) {
      blocked(u, "blocked_address");
    }
  });

  it("lets everything through with allowPrivateNetwork (tests only)", () => {
    expect(() => assertUrlAllowed(new URL("http://127.0.0.1:5173/"), true)).not.toThrow();
    expect(() => assertUrlAllowed(new URL("ftp://127.0.0.1/"), true)).toThrow(CrawlError);
  });
});

describe("assertRedirectAllowed", () => {
  it("allows http → https and cross-host redirects to public hosts", () => {
    expect(() => assertRedirectAllowed(new URL("http://hotel.tg/"), new URL("https://hotel.tg/"), false)).not.toThrow();
    expect(() => assertRedirectAllowed(new URL("https://hotel.tg/"), new URL("https://hotel-new.com/"), false)).not.toThrow();
  });

  it("allows https → http only on the same host (www ignored)", () => {
    expect(() => assertRedirectAllowed(new URL("https://hotel.tg/"), new URL("http://www.hotel.tg/"), false)).not.toThrow();
    expect(() => assertRedirectAllowed(new URL("https://hotel.tg/"), new URL("http://elsewhere.tg/"), false)).toThrow(/HTTPS to plain HTTP/);
  });

  it("re-validates the target of every hop", () => {
    expect(() => assertRedirectAllowed(new URL("https://hotel.tg/"), new URL("http://169.254.169.254/"), false)).toThrow(CrawlError);
    expect(() => assertRedirectAllowed(new URL("https://hotel.tg/"), new URL("https://hotel.tg:8443/"), false)).toThrow(/standard web ports/);
    expect(() => assertRedirectAllowed(new URL("https://hotel.tg/"), new URL("javascript:alert(1)"), false)).toThrow(/http and https/);
  });

  it("sameHost ignores case, trailing dot and www", () => {
    expect(sameHost("WWW.Hotel.tg", "hotel.tg.")).toBe(true);
    expect(sameHost("shop.hotel.tg", "hotel.tg")).toBe(false);
  });
});

describe("resolveAllowedAddresses / createSafeLookup", () => {
  const table: Record<string, { address: string; family: 4 | 6 }[]> = {
    "public.test": [{ address: "93.184.216.34", family: 4 }],
    "mixed.test": [
      { address: "10.0.0.5", family: 4 },
      { address: "2606:4700::1", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ],
    "private.test": [{ address: "10.0.0.5", family: 4 }],
    "mapped.test": [{ address: "::ffff:127.0.0.1", family: 6 }],
    "metadata.test": [{ address: "169.254.169.254", family: 4 }],
    "empty.test": [],
  };
  const resolver: HostResolver = async (host, family) => {
    const all = table[host];
    if (!all) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return family === 0 ? all : all.filter((a) => a.family === family);
  };

  const lookup = (host: string, options: { all?: boolean; family?: number }, allowPrivateNetwork = false) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>((resolve) => {
      createSafeLookup({ allowPrivateNetwork, resolver })(host, options, (err, address, family) => resolve({ err, address, family }));
    });

  it("returns only public addresses (all: true)", async () => {
    const r = await lookup("mixed.test", { all: true });
    expect(r.err).toBeNull();
    expect(r.address).toEqual([
      { address: "2606:4700::1", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("returns the first public address in single-address mode and honours family", async () => {
    expect(await lookup("public.test", {})).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
    expect(await lookup("mixed.test", { family: 4 })).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
  });

  it.each(["private.test", "mapped.test", "metadata.test"])("refuses %s (resolves only to blocked addresses)", async (host) => {
    const r = await lookup(host, { all: true });
    expect(r.err).toBeInstanceOf(CrawlError);
    expect((r.err as unknown as CrawlError).kind).toBe("blocked_address");
  });

  it("reports unknown and empty names as DNS failures", async () => {
    expect((await lookup("nope.test", {})).err?.code).toBe("ENOTFOUND");
    expect((await lookup("empty.test", {})).err?.code).toBe("ENOTFOUND");
  });

  it("passes private addresses through only with allowPrivateNetwork", async () => {
    expect(await lookup("private.test", {}, true)).toMatchObject({ err: null, address: "10.0.0.5" });
    await expect(resolveAllowedAddresses("10.0.0.5", { allowPrivateNetwork: false })).rejects.toBeInstanceOf(CrawlError);
    await expect(resolveAllowedAddresses("8.8.8.8", { allowPrivateNetwork: false })).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
  });

  it("is what node:http actually uses to connect: a host resolving to 127.0.0.1 is refused", async () => {
    const server = await startTestServer({ "/": { body: "<p>secret</p>" } });
    try {
      const localhostResolver: HostResolver = async () => [{ address: "127.0.0.1", family: 4 }];
      const err = await new Promise<Error>((resolve, reject) => {
        const req = http.get(
          { hostname: "innocent.test", port: server.port, path: "/", agent: false, lookup: createSafeLookup({ allowPrivateNetwork: false, resolver: localhostResolver }) },
          () => reject(new Error("connected to a private address")),
        );
        req.on("error", resolve);
      });
      expect(err).toBeInstanceOf(CrawlError);
      expect(server.hits).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
