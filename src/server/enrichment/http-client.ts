import "server-only";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import { Readable, pipeline } from "node:stream";
import zlib from "node:zlib";
import { CrawlError, toCrawlError } from "./errors";
import { assertRedirectAllowed, assertUrlAllowed, createSafeLookup, resolveAllowedAddresses, unbracket, type HostResolver } from "./ip-guard";

/**
 * SSRF-safe HTTP GET for the website crawler.
 *
 * - Built-in transport: node:http / node:https with a validating DNS `lookup` (the IP we check is
 *   the IP we connect to), a fresh connection per request (no shared socket pool), no proxy.
 * - Redirects are followed manually (max 5), each hop re-validated (scheme, port, literal IP; DNS
 *   at connect time), HTTPS → HTTP only on the same host.
 * - One deadline per call covers every hop and the body. Bodies are decompressed (gzip, deflate,
 *   br) and capped: reading stops at `maxBytes` and the connection is closed.
 *
 * An injected `fetch` (tests, other modules' fakes) replaces the transport; URLs are still checked
 * and host names are resolved and checked before each request, but the connection itself is not
 * pinned to the checked IP — use the built-in transport in production.
 */

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchedResponse = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  /** Lower-cased MIME type without parameters, or null when the server sent none. */
  mimeType: string | null;
  charset: string | null;
  /** Null when the body was not read (see `shouldReadBody`). */
  body: Buffer | null;
  /** Body was cut at `maxBytes`. */
  truncated: boolean;
  /** Every redirect target followed, in order. */
  redirects: string[];
  elapsedMs: number;
};

export type GetOptions = {
  timeoutMs: number;
  maxBytes: number;
  accept: string;
  /** Read the body only when this returns true (default: always). Other bodies are discarded unread. */
  shouldReadBody?: (status: number, mimeType: string | null) => boolean;
  /** Called before following a redirect; throw (e.g. a robots CrawlError) to stop. */
  beforeRedirect?: (next: URL) => Promise<void>;
  signal?: AbortSignal;
};

export type SafeClientConfig = {
  allowPrivateNetwork: boolean;
  userAgent: string;
  acceptLanguage: string;
  resolver?: HostResolver;
  fetch?: typeof fetch;
  maxRedirects?: number;
};

export interface SafeHttpClient {
  get(url: URL, opts: GetOptions): Promise<FetchedResponse>;
}

type RawResponse = {
  status: number;
  header(name: string): string | undefined;
  readBody(maxBytes: number): Promise<{ body: Buffer; truncated: boolean }>;
  discard(): void;
};

type Transport = (url: URL, headers: Record<string, string>, signal: AbortSignal) => Promise<RawResponse>;

export function parseContentType(value: string | undefined | null): { mimeType: string | null; charset: string | null } {
  if (!value) return { mimeType: null, charset: null };
  const [type, ...params] = value.split(";");
  const mimeType = type?.trim().toLowerCase() || null;
  let charset: string | null = null;
  for (const p of params) {
    const m = /^\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(p);
    if (m) charset = m[1]!;
  }
  return { mimeType, charset };
}

/** Read a byte stream up to `maxBytes`; stop (and report truncation) beyond that. */
async function readCapped(stream: AsyncIterable<Uint8Array>, maxBytes: number): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const room = maxBytes - size;
    if (buf.length > room) {
      if (room > 0) chunks.push(buf.subarray(0, room));
      size = maxBytes;
      truncated = true;
      break; // leaving the loop destroys the stream (and the connection behind it)
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { body: Buffer.concat(chunks, size), truncated };
}

/** A zlib-wrapped or raw deflate stream (servers send both as "Content-Encoding: deflate"). */
function autoInflate(source: Readable): Readable {
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
  return Readable.from(
    (async function* inflate(): AsyncGenerator<Buffer> {
      const it = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
      const head: Buffer[] = [];
      let len = 0;
      while (len < 2) {
        const n = await it.next();
        if (n.done) break;
        head.push(n.value);
        len += n.value.length;
      }
      const first = Buffer.concat(head);
      if (first.length === 0) return;
      // RFC 1950 header: CM = 8 and (CMF·256 + FLG) divisible by 31.
      const zlibHeader = first.length >= 2 && (first[0]! & 0x0f) === 8 && ((first[0]! << 8) | first[1]!) % 31 === 0;
      const compressed = (async function* rest(): AsyncGenerator<Buffer> {
        yield first;
        for (;;) {
          const n = await it.next();
          if (n.done) return;
          yield n.value;
        }
      })();
      const inflater = zlibHeader ? zlib.createInflate(opts) : zlib.createInflateRaw(opts);
      const decoded = pipeline(Readable.from(compressed), inflater, () => {});
      for await (const chunk of decoded) yield chunk as Buffer;
    })(),
  );
}

function decodedBody(res: IncomingMessage): Readable {
  const encoding = (res.headers["content-encoding"] ?? "identity").toString().trim().toLowerCase();
  const noop = () => {};
  switch (encoding) {
    case "":
    case "identity":
      return res;
    case "gzip":
    case "x-gzip":
      return pipeline(res, zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH }), noop);
    case "br":
      return pipeline(res, zlib.createBrotliDecompress({ finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }), noop);
    case "deflate":
      return autoInflate(res);
    default:
      throw new CrawlError("protocol", `The server used an unsupported compression (${encoding.slice(0, 20)})`);
  }
}

function nodeTransport(lookup: LookupFunction): Transport {
  return (url, headers, signal) =>
    new Promise<RawResponse>((resolve, reject) => {
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(
        {
          protocol: url.protocol,
          hostname: unbracket(url.hostname),
          port: url.port ? Number(url.port) : undefined,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: { ...headers, "accept-encoding": "gzip, deflate, br" },
          // A dedicated connection: never reuse a pooled socket opened without our lookup.
          agent: false,
          lookup,
          signal,
        },
        (res) => {
          // Errors after the response arrived surface through readBody(); never leave them unhandled.
          res.on("error", () => {});
          resolve({
            status: res.statusCode ?? 0,
            header: (name) => {
              const v = res.headers[name.toLowerCase()];
              return Array.isArray(v) ? v.join(", ") : v;
            },
            readBody: async (maxBytes) => {
              try {
                return await readCapped(decodedBody(res), maxBytes);
              } finally {
                res.destroy();
              }
            },
            discard: () => res.destroy(),
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
}

function fetchTransport(fetchImpl: typeof fetch): Transport {
  return async (url, headers, signal) => {
    const res = await fetchImpl(url.href, { method: "GET", headers, redirect: "manual", signal });
    const cancel = () => {
      void res.body?.cancel().catch(() => {});
    };
    return {
      status: res.status,
      header: (name) => res.headers.get(name) ?? undefined,
      readBody: async (maxBytes) => {
        if (!res.body) return { body: Buffer.alloc(0), truncated: false };
        const reader = res.body.getReader();
        async function* chunks(): AsyncGenerator<Uint8Array> {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        }
        try {
          return await readCapped(chunks(), maxBytes);
        } finally {
          void reader.cancel().catch(() => {});
        }
      },
      discard: cancel,
    };
  };
}

function resolveRedirect(current: URL, location: string): URL {
  try {
    return new URL(location, current);
  } catch {
    throw new CrawlError("bad_redirect", "The website redirected to an invalid address", current.href);
  }
}

export function createSafeHttpClient(config: SafeClientConfig): SafeHttpClient {
  const maxRedirects = config.maxRedirects ?? MAX_REDIRECTS;
  const transport = config.fetch
    ? fetchTransport(config.fetch)
    : nodeTransport(createSafeLookup({ allowPrivateNetwork: config.allowPrivateNetwork, resolver: config.resolver }));

  /** Checks before each request; with an injected fetch also the DNS answer (best effort). */
  async function preflight(url: URL) {
    assertUrlAllowed(url, config.allowPrivateNetwork);
    if (config.fetch && !config.allowPrivateNetwork) {
      await resolveAllowedAddresses(url.hostname, { allowPrivateNetwork: false, resolver: config.resolver });
    }
  }

  return {
    async get(start, opts) {
      const t0 = performance.now();
      const deadline = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        deadline.abort();
      }, opts.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, deadline.signal]) : deadline.signal;
      const headers: Record<string, string> = {
        "user-agent": config.userAgent,
        accept: opts.accept,
        "accept-language": config.acceptLanguage,
      };
      const redirects: string[] = [];
      let current = start;
      try {
        if (signal.aborted) throw new CrawlError("aborted", "Cancelled", start.href);
        for (;;) {
          await preflight(current);
          const res = await transport(current, headers, signal);
          const location = REDIRECT_STATUSES.has(res.status) ? res.header("location") : undefined;
          if (location) {
            res.discard();
            if (redirects.length >= maxRedirects) {
              throw new CrawlError("too_many_redirects", `Too many redirects (more than ${maxRedirects})`, current.href);
            }
            const next = resolveRedirect(current, location);
            assertRedirectAllowed(current, next, config.allowPrivateNetwork);
            if (opts.beforeRedirect) await opts.beforeRedirect(next);
            redirects.push(next.href);
            current = next;
            continue;
          }
          const { mimeType, charset } = parseContentType(res.header("content-type"));
          const wanted = opts.shouldReadBody ? opts.shouldReadBody(res.status, mimeType) : true;
          let body: Buffer | null = null;
          let truncated = false;
          if (wanted) ({ body, truncated } = await res.readBody(opts.maxBytes));
          else res.discard();
          return {
            requestedUrl: start.href,
            finalUrl: current.href,
            status: res.status,
            mimeType,
            charset,
            body,
            truncated,
            redirects,
            elapsedMs: Math.round(performance.now() - t0),
          };
        }
      } catch (err) {
        const e = toCrawlError(err, { timedOut, aborted: opts.signal?.aborted ?? false, timeoutMs: opts.timeoutMs, url: current.href });
        // Keep the URL the failure happened on, even for errors created without one.
        throw e.url ? e : new CrawlError(e.kind, e.message, current.href);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
