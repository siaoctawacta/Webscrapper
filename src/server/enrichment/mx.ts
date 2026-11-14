import "server-only";
import dns from "node:dns";

/**
 * Mail-server (MX) check for the domains of published emails. It only tells whether the domain can
 * receive mail at all; it never verifies a mailbox.
 *   true  = at least one MX record;
 *   false = the domain does not exist or has no (or only a "null", RFC 7505) MX record;
 *   omitted = the lookup failed or timed out (we know nothing).
 */

export const MX_TIMEOUT_MS = 3000;
export const MAX_MX_DOMAINS = 3;

export type ResolveMx = (domain: string) => Promise<string[]>;

const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export const defaultResolveMx: ResolveMx = async (domain) => {
  const resolver = new dns.promises.Resolver({ timeout: MX_TIMEOUT_MS, tries: 2 });
  const records = await resolver.resolveMx(domain);
  return records.map((r) => r.exchange).filter((x) => x !== "" && x !== ".");
};

const TIMED_OUT = Symbol("timeout");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Check up to MAX_MX_DOMAINS distinct domains (in the order given), in parallel. */
export async function checkMx(domains: string[], resolveMx: ResolveMx = defaultResolveMx, timeoutMs = MX_TIMEOUT_MS): Promise<Record<string, boolean>> {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase().replace(/\.+$/, "")).filter(Boolean))].slice(0, MAX_MX_DOMAINS);
  const out: Record<string, boolean> = {};
  await Promise.all(
    unique.map(async (domain) => {
      try {
        const r = await withTimeout(resolveMx(domain), timeoutMs);
        if (r === TIMED_OUT) return;
        out[domain] = r.some((x) => typeof x === "string" && x.trim() !== "" && x.trim() !== ".");
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
        if (NO_RECORD_CODES.has(code)) out[domain] = false;
      }
    }),
  );
  return out;
}
