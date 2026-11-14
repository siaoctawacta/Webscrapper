/**
 * SSRF protection for the website crawler: which URLs and IP addresses we are willing to connect to.
 *
 * Rules (unless `allowPrivateNetwork`, which only tests set):
 *   - http/https only, no credentials in the URL, default ports only (80/443);
 *   - every IP we connect to must be public unicast: ipaddr.js range "unicast" (IPv4-mapped IPv6 is
 *     judged by its IPv4 address; other IPv6 must also be inside 2000::/3, the global unicast block);
 *   - the check runs inside the socket's DNS `lookup`, so the address we validate is the address we
 *     connect to (no DNS-rebinding window).
 *
 * No secrets, no database: safe to unit test directly.
 */
import dns from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { CrawlError } from "./errors";

export type ResolvedAddress = { address: string; family: 4 | 6 };
/** DNS resolver used to connect. Injected in tests to map fake hostnames to local addresses. */
export type HostResolver = (hostname: string, family: 0 | 4 | 6) => Promise<ResolvedAddress[]>;

export const BLOCKED_ADDRESS_MESSAGE = "Blocked: the website address points to a private or reserved network";

/** Strip the brackets WHATWG URL keeps around IPv6 hostnames. */
export const unbracket = (host: string) => (host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host);

const GLOBAL_UNICAST_V6 = ipaddr.IPv6.parseCIDR("2000::/3");

/**
 * The ipaddr.js range name of an address, after unwrapping IPv4-mapped IPv6. IPv6 outside 2000::/3
 * that ipaddr.js would still call "unicast" is reported as "nonGlobal". Unparseable → "invalid".
 */
export function classifyIp(address: string): string {
  const raw = unbracket(address.trim());
  // Zone ids (fe80::1%eth0) are only meaningful for link-local addresses, which are blocked anyway.
  const withoutZone = raw.includes("%") ? raw.slice(0, raw.indexOf("%")) : raw;
  const version = isIP(withoutZone);
  if (!version) return "invalid";
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    // Canonicalize IPv6 first: ipaddr.js reads a trailing dotted quad ("::127.0.0.1", IPv4-compatible)
    // as IPv4-mapped; the WHATWG serializer turns it into the hex form Node actually connects to.
    const canonical = version === 6 ? new URL(`http://[${withoutZone}]/`).hostname.slice(1, -1) : withoutZone;
    parsed = ipaddr.parse(canonical);
  } catch {
    return "invalid";
  }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range();
    const range = v6.range();
    if (range === "unicast" && !v6.match(GLOBAL_UNICAST_V6)) return "nonGlobal";
    return range;
  }
  return (parsed as ipaddr.IPv4).range();
}

/** True only for public unicast addresses we may connect to. */
export const isPublicIp = (address: string) => classifyIp(address) === "unicast";

/** Same host for redirect rules: case-insensitive, "www." ignored. */
export function sameHost(a: string, b: string): boolean {
  const norm = (h: string) => unbracket(h).toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return norm(a) === norm(b);
}

/**
 * Validate a URL before connecting: scheme, credentials, port and literal-IP hosts. DNS names are
 * validated later, at connect time, by the safe lookup.
 */
export function assertUrlAllowed(url: URL, allowPrivateNetwork: boolean): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrawlError("invalid_url", "Only http and https web addresses are visited", url.href);
  }
  if (url.username || url.password) {
    throw new CrawlError("invalid_url", "Web addresses with a user name or password are not visited", url.href);
  }
  const host = unbracket(url.hostname);
  if (!host) throw new CrawlError("invalid_url", "The web address has no host name", url.href);
  if (allowPrivateNetwork) return;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new CrawlError("blocked_port", "Only standard web ports (80 and 443) are visited", url.href);
  }
  const lower = host.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    throw new CrawlError("blocked_address", BLOCKED_ADDRESS_MESSAGE, url.href);
  }
  if (isIP(host) && !isPublicIp(host)) {
    throw new CrawlError("blocked_address", BLOCKED_ADDRESS_MESSAGE, url.href);
  }
}

/**
 * Validate one redirect hop. Cross-host redirects are allowed (the target is re-validated), plain
 * HTTP after HTTPS only on the same host.
 */
export function assertRedirectAllowed(from: URL, to: URL, allowPrivateNetwork: boolean): void {
  assertUrlAllowed(to, allowPrivateNetwork);
  if (from.protocol === "https:" && to.protocol === "http:" && !sameHost(from.hostname, to.hostname)) {
    throw new CrawlError("bad_redirect", "Refused a redirect from HTTPS to plain HTTP on another site", to.href);
  }
}

/** Default resolver: the system resolver (same as the browser would use), all addresses. */
export const systemResolver: HostResolver = async (hostname, family) => {
  const records = await dns.promises.lookup(hostname, { all: true, family, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** Resolve a host name and keep only addresses we may connect to; throws when none is left. */
export async function resolveAllowedAddresses(
  hostname: string,
  opts: { allowPrivateNetwork: boolean; resolver?: HostResolver; family?: 0 | 4 | 6 },
): Promise<ResolvedAddress[]> {
  const host = unbracket(hostname);
  if (isIP(host)) {
    if (!opts.allowPrivateNetwork && !isPublicIp(host)) throw new CrawlError("blocked_address", BLOCKED_ADDRESS_MESSAGE);
    return [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  }
  const resolved = await (opts.resolver ?? systemResolver)(host, opts.family ?? 0);
  const usable = opts.allowPrivateNetwork ? resolved : resolved.filter((a) => isPublicIp(a.address));
  if (usable.length === 0) {
    if (resolved.length === 0) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND", hostname: host });
    }
    throw new CrawlError("blocked_address", BLOCKED_ADDRESS_MESSAGE);
  }
  return usable;
}

function lookupFamily(family: unknown): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
}

/**
 * A `lookup` for node:net / node:http(s) that resolves the host and refuses non-public addresses.
 * Because Node connects to exactly the address returned here, validation and connection use the
 * same IP. Supports both `all: true` (Happy Eyeballs) and single-address callers.
 */
export function createSafeLookup(opts: { allowPrivateNetwork: boolean; resolver?: HostResolver }): LookupFunction {
  return (hostname, options, callback) => {
    resolveAllowedAddresses(hostname, { ...opts, family: lookupFamily(options.family) }).then(
      (addresses) => {
        if (options.all) {
          callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
        } else {
          const first = addresses[0]!;
          callback(null, first.address, first.family);
        }
      },
      (err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        callback(e as NodeJS.ErrnoException, "");
      },
    );
  };
}
