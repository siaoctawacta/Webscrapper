import "server-only";
import robotsParser from "robots-parser";
import { CrawlError } from "./errors";
import type { SafeHttpClient } from "./http-client";

/**
 * robots.txt handling per RFC 9309, fetched once per origin through the same SSRF-safe client:
 *   - 2xx → parse the rules (first 64 KB);
 *   - 4xx (or more than 5 redirects) → "unavailable": everything allowed;
 *   - 5xx → "unreachable": everything disallowed;
 *   - network failure (DNS, refused, timeout, blocked address) → nothing fetched; the caller reports
 *     the site as unreachable (or blocked) instead of crawling.
 */

export const ROBOTS_UA = "LeadFinderBot";
export const ROBOTS_MAX_BYTES = 64 * 1024;
export const ROBOTS_TIMEOUT_MS = 5000;

type Robot = ReturnType<typeof robotsParser>;

export type RobotsRules =
  | { kind: "allow_all" }
  | { kind: "rules"; robot: Robot }
  | { kind: "disallow_all"; reason: string }
  | { kind: "failed"; error: CrawlError };

export type RobotsVerdict =
  | { allowed: true }
  | { allowed: false; reason: string }
  /** robots.txt could not be fetched at all (site down, blocked address…). */
  | { allowed: false; error: CrawlError };

export type RobotsOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class RobotsCache {
  private readonly byOrigin = new Map<string, Promise<RobotsRules>>();

  constructor(
    private readonly client: SafeHttpClient,
    private readonly opts: RobotsOptions = {},
  ) {}

  rulesFor(origin: string): Promise<RobotsRules> {
    let p = this.byOrigin.get(origin);
    if (!p) {
      p = this.fetchRules(origin);
      this.byOrigin.set(origin, p);
    }
    return p;
  }

  /** Crawl-delay for our UA on this origin (seconds), if the rules set one. */
  async crawlDelaySeconds(origin: string): Promise<number | null> {
    const rules = await this.rulesFor(origin);
    if (rules.kind !== "rules") return null;
    const d = rules.robot.getCrawlDelay(ROBOTS_UA);
    return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
  }

  async check(url: URL): Promise<RobotsVerdict> {
    const rules = await this.rulesFor(url.origin);
    switch (rules.kind) {
      case "allow_all":
        return { allowed: true };
      case "disallow_all":
        return { allowed: false, reason: rules.reason };
      case "failed":
        return { allowed: false, error: rules.error };
      case "rules":
        // undefined = URL not covered by this file (cannot happen for same origin) → allowed.
        return rules.robot.isAllowed(url.href, ROBOTS_UA) === false
          ? { allowed: false, reason: "robots.txt asks crawlers not to visit this page" }
          : { allowed: true };
    }
  }

  private async fetchRules(origin: string): Promise<RobotsRules> {
    const robotsUrl = new URL("/robots.txt", origin);
    try {
      const res = await this.client.get(robotsUrl, {
        timeoutMs: Math.min(this.opts.timeoutMs ?? ROBOTS_TIMEOUT_MS, ROBOTS_TIMEOUT_MS),
        maxBytes: ROBOTS_MAX_BYTES,
        accept: "text/plain,*/*;q=0.8",
        shouldReadBody: (status) => status >= 200 && status < 300,
        signal: this.opts.signal,
      });
      if (res.status >= 200 && res.status < 300) {
        const text = new TextDecoder("utf-8").decode(res.body ?? new Uint8Array());
        // Rules are matched against the original robots URL's origin, even after a redirect.
        return { kind: "rules", robot: robotsParser(robotsUrl.href, text) };
      }
      if (res.status >= 500) {
        return { kind: "disallow_all", reason: `robots.txt could not be read (server error ${res.status}), so the site is treated as off-limits` };
      }
      // 4xx, 3xx without a destination, 1xx…: "unavailable" → no restrictions.
      return { kind: "allow_all" };
    } catch (err) {
      const e = err instanceof CrawlError ? err : new CrawlError("connect", "Could not load robots.txt", robotsUrl.href);
      if (e.kind === "too_many_redirects") return { kind: "allow_all" };
      return { kind: "failed", error: e };
    }
  }
}
