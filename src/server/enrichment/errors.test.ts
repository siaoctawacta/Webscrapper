import { describe, expect, it } from "vitest";
import { CrawlError, formatSeconds, isUnreachableKind, toCrawlError } from "./errors";

const ctx = { timedOut: false, aborted: false, timeoutMs: 10_000, url: "https://hotel.tg/" };
const sysError = (code: string, message = code) => Object.assign(new Error(message), { code });

describe("toCrawlError", () => {
  it.each([
    ["ENOTFOUND", "dns", "Domain name not found (DNS lookup failed)"],
    ["EAI_AGAIN", "dns", "DNS lookup failed"],
    ["ECONNREFUSED", "connect", "Connection refused by the server"],
    ["ECONNRESET", "connect", "Connection closed by the server"],
    ["EHOSTUNREACH", "connect", "Server could not be reached"],
    ["ETIMEDOUT", "timeout", "No response within 10 s"],
    ["CERT_HAS_EXPIRED", "tls", "HTTPS certificate has expired"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls", "HTTPS certificate does not match the domain"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls", "HTTPS certificate is self-signed"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls", "HTTPS connection failed (TLS error)"],
    ["HPE_INVALID_CONSTANT", "protocol", "The server sent an invalid HTTP response"],
    ["Z_DATA_ERROR", "protocol", "The server sent a corrupted compressed response"],
  ])("maps %s → %s", (code, kind, message) => {
    const e = toCrawlError(sysError(code), ctx);
    expect(e).toBeInstanceOf(CrawlError);
    expect(e.kind).toBe(kind);
    expect(e.message).toBe(message);
    expect(e.url).toBe("https://hotel.tg/");
  });

  it("follows `cause` chains (fetch wraps network errors)", () => {
    const wrapped = new TypeError("fetch failed", { cause: sysError("ECONNREFUSED") });
    expect(toCrawlError(wrapped, ctx).kind).toBe("connect");
    const blocked = new TypeError("fetch failed", { cause: new CrawlError("blocked_address", "Blocked") });
    expect(toCrawlError(blocked, ctx).kind).toBe("blocked_address");
  });

  it("prefers our own deadline and the caller's cancellation over the raw error", () => {
    expect(toCrawlError(new Error("This operation was aborted"), { ...ctx, timedOut: true, timeoutMs: 2500 }).message).toBe("No response within 2.5 s");
    expect(toCrawlError(new Error("This operation was aborted"), { ...ctx, aborted: true }).kind).toBe("aborted");
  });

  it("keeps CrawlErrors as they are and has a generic fallback", () => {
    const original = new CrawlError("robots", "robots.txt asks crawlers not to visit this page");
    expect(toCrawlError(original, ctx)).toBe(original);
    expect(toCrawlError(new Error("socket hang up"), ctx).message).toBe("Connection closed by the server");
    expect(toCrawlError("weird", ctx)).toMatchObject({ kind: "connect", message: "Could not load the website" });
  });
});

describe("helpers", () => {
  it("formats seconds and classifies unreachable kinds", () => {
    expect(formatSeconds(10_000)).toBe("10 s");
    expect(formatSeconds(300)).toBe("0.3 s");
    expect(isUnreachableKind("dns")).toBe(true);
    expect(isUnreachableKind("timeout")).toBe(true);
    expect(isUnreachableKind("blocked_address")).toBe(false);
    expect(isUnreachableKind("tls")).toBe(false);
  });
});
