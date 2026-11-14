import { describe, expect, it, vi } from "vitest";
import { MAX_MX_DOMAINS, checkMx, type ResolveMx } from "./mx";

const dnsError = (code: string) => Object.assign(new Error(`queryMx ${code}`), { code });

describe("checkMx", () => {
  const resolver: ResolveMx = async (domain) => {
    switch (domain) {
      case "hotel-benin.tg":
      case "gmail.com":
        return ["mx1.example.net", "mx2.example.net"];
      case "nomx.tg":
        return [];
      case "nullmx.tg":
        return ["."]; // RFC 7505 "null MX": the domain accepts no mail
      case "gone.tg":
        throw dnsError("ENOTFOUND");
      case "nodata.tg":
        throw dnsError("ENODATA");
      case "flaky.tg":
        throw dnsError("ESERVFAIL");
      default:
        throw dnsError("ETIMEOUT");
    }
  };

  it("maps each domain to true (has a mail server) or false (none / no such domain)", async () => {
    expect(await checkMx(["hotel-benin.tg", "nomx.tg", "gone.tg"], resolver)).toEqual({ "hotel-benin.tg": true, "nomx.tg": false, "gone.tg": false });
    expect(await checkMx(["nodata.tg", "nullmx.tg"], resolver)).toEqual({ "nodata.tg": false, "nullmx.tg": false });
  });

  it("leaves a domain out when the lookup fails for another reason (we know nothing)", async () => {
    expect(await checkMx(["flaky.tg", "unknown.tg", "gmail.com"], resolver)).toEqual({ "gmail.com": true });
  });

  it("leaves a domain out when the lookup is slower than the timeout", async () => {
    const slow: ResolveMx = (domain) =>
      domain === "slow.tg" ? new Promise((resolve) => setTimeout(() => resolve(["mx.slow.tg"]), 500)) : Promise.resolve(["mx.fast.tg"]);
    const t0 = Date.now();
    expect(await checkMx(["slow.tg", "fast.tg"], slow, 50)).toEqual({ "fast.tg": true });
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it(`checks at most ${MAX_MX_DOMAINS} distinct domains, lower-cased, in the given order`, async () => {
    const spy = vi.fn(async () => ["mx.x.tg"]);
    const out = await checkMx(["A.tg", "a.tg", "b.tg.", "c.tg", "d.tg", ""], spy);
    expect(spy.mock.calls.map((c: unknown[]) => c[0])).toEqual(["a.tg", "b.tg", "c.tg"]);
    expect(out).toEqual({ "a.tg": true, "b.tg": true, "c.tg": true });
  });

  it("returns an empty map when there is nothing to check", async () => {
    const spy = vi.fn(async () => ["mx"]);
    expect(await checkMx([], spy)).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});
