/**
 * Crawl failures, classified so the caller can tell "the site is down" apart from "we refused to go
 * there" and show a short, plain-language reason. Pure module (no I/O).
 */

export type CrawlErrorKind =
  /** Not an http(s) address we can visit. */
  | "invalid_url"
  /** The address resolves to (or is) a private, loopback, link-local or reserved IP. */
  | "blocked_address"
  /** Non-standard port (only 80/443 are visited). */
  | "blocked_port"
  /** Domain name does not resolve. */
  | "dns"
  /** TCP connection refused / reset / host unreachable. */
  | "connect"
  | "timeout"
  /** HTTPS certificate or handshake problem. */
  | "tls"
  | "too_many_redirects"
  /** Redirect without a usable destination, or one we refuse to follow (e.g. HTTPS → HTTP elsewhere). */
  | "bad_redirect"
  /** robots.txt does not allow the page we were sent to. */
  | "robots"
  /** Malformed HTTP response, unsupported encoding… */
  | "protocol"
  /** The caller's AbortSignal fired. */
  | "aborted";

export class CrawlError extends Error {
  constructor(
    public readonly kind: CrawlErrorKind,
    message: string,
    /** URL being fetched when the error happened, when known. */
    public readonly url?: string,
  ) {
    super(message);
    this.name = "CrawlError";
  }
}

/** Kinds that mean "we could not reach the site" (→ websiteCheck.status "unreachable"). */
const UNREACHABLE_KINDS: ReadonlySet<CrawlErrorKind> = new Set(["dns", "connect", "timeout"]);

export const isUnreachableKind = (kind: CrawlErrorKind) => UNREACHABLE_KINDS.has(kind);

const TLS_MESSAGES: Record<string, string> = {
  CERT_HAS_EXPIRED: "HTTPS certificate has expired",
  CERT_NOT_YET_VALID: "HTTPS certificate is not valid yet",
  ERR_TLS_CERT_ALTNAME_INVALID: "HTTPS certificate does not match the domain",
  DEPTH_ZERO_SELF_SIGNED_CERT: "HTTPS certificate is self-signed",
  SELF_SIGNED_CERT_IN_CHAIN: "HTTPS certificate is self-signed",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "HTTPS certificate chain is incomplete",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "HTTPS certificate chain is incomplete",
  UNABLE_TO_GET_ISSUER_CERT: "HTTPS certificate chain is incomplete",
  CERT_REVOKED: "HTTPS certificate has been revoked",
};

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return undefined;
}

/** Walks `cause` chains (fetch wraps the network error in a TypeError with `cause`). */
function rootCause(err: unknown): unknown {
  let cur = err;
  for (let i = 0; i < 5; i++) {
    if (cur instanceof CrawlError) return cur;
    if (errorCode(cur)) return cur;
    if (cur && typeof cur === "object" && "cause" in cur && (cur as { cause: unknown }).cause) {
      cur = (cur as { cause: unknown }).cause;
    } else break;
  }
  return cur;
}

export type ErrorContext = {
  /** Our own deadline fired. */
  timedOut: boolean;
  /** The caller's signal fired. */
  aborted: boolean;
  timeoutMs: number;
  url?: string;
};

export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1)} s`;
}

/** Turn anything thrown by the network stack into a CrawlError with a short, readable message. */
export function toCrawlError(err: unknown, ctx: ErrorContext): CrawlError {
  if (err instanceof CrawlError) return err;
  const url = ctx.url;
  if (ctx.timedOut) return new CrawlError("timeout", `No response within ${formatSeconds(ctx.timeoutMs)}`, url);
  if (ctx.aborted) return new CrawlError("aborted", "Cancelled", url);

  const cause = rootCause(err);
  if (cause instanceof CrawlError) return cause;
  const code = errorCode(cause);

  switch (code) {
    case "ENOTFOUND":
      return new CrawlError("dns", "Domain name not found (DNS lookup failed)", url);
    case "EAI_AGAIN":
    case "ESERVFAIL":
    case "ENODATA":
      return new CrawlError("dns", "DNS lookup failed", url);
    case "ECONNREFUSED":
      return new CrawlError("connect", "Connection refused by the server", url);
    case "ECONNRESET":
    case "EPIPE":
    case "UND_ERR_SOCKET":
      return new CrawlError("connect", "Connection closed by the server", url);
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "EHOSTDOWN":
    case "ENETDOWN":
      return new CrawlError("connect", "Server could not be reached", url);
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return new CrawlError("timeout", `No response within ${formatSeconds(ctx.timeoutMs)}`, url);
    default:
      break;
  }
  if (code && TLS_MESSAGES[code]) return new CrawlError("tls", TLS_MESSAGES[code], url);
  if (code && (code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS") || code === "EPROTO" || code.includes("CERT"))) {
    return new CrawlError("tls", "HTTPS connection failed (TLS error)", url);
  }
  if (code && code.startsWith("HPE_")) return new CrawlError("protocol", "The server sent an invalid HTTP response", url);
  // zlib ("Z_DATA_ERROR"…) and brotli ("ERR__ERROR_FORMAT_…", "ERR_BROTLI_…") decoder failures.
  if (code && (code.startsWith("Z_") || code.startsWith("ERR__ERROR") || code.startsWith("ERR_BROTLI"))) {
    return new CrawlError("protocol", "The server sent a corrupted compressed response", url);
  }
  const message = err instanceof Error && err.message === "socket hang up" ? "Connection closed by the server" : null;
  if (message) return new CrawlError("connect", message, url);
  return new CrawlError("connect", "Could not load the website", url);
}
