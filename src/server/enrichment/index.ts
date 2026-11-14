import "server-only";
import type { FoundEmail, Socials, WebsiteCheck, WebsiteStatus } from "@/lib/domain";
import { env } from "../env";
import { MAX_EMAILS, emailDomainOf, rankEmails } from "./emails";
import { decodeHtml } from "./charset";
import { isSameSiteHost } from "./domain";
import { CrawlError, isUnreachableKind, toCrawlError } from "./errors";
import { extractPage, type PageExtraction } from "./extract";
import { createSafeHttpClient, type FetchedResponse, type GetOptions } from "./http-client";
import { assertUrlAllowed, type HostResolver } from "./ip-guard";
import { selectSubpages } from "./links";
import { checkMx, defaultResolveMx } from "./mx";
import { RobotsCache } from "./robots";

export type EnrichmentResult = {
  websiteStatus: Exclude<WebsiteStatus, "none" | "unknown"> | "unknown";
  websiteCheck: WebsiteCheck;
  /** Best first: same-domain addresses, then others. Max 5. */
  emails: FoundEmail[];
  socials: Socials;
  /** tel: links found on the site (raw). */
  phones: string[];
  /** Mail-server check per email domain that was checked: false = domain has no MX record (→ email needs review). */
  mx: Record<string, boolean>;
};

export type EnrichOptions = {
  signal?: AbortSignal;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Tests only: allow localhost/private addresses (production blocks them — SSRF protection). */
  allowPrivateNetwork?: boolean;
  /** Override DNS MX lookup (tests). Return [] when the domain has no mail server. */
  resolveMx?: (domain: string) => Promise<string[]>;
  timeoutMs?: number;
  maxPages?: number;
  userAgent?: string;
};

/** Test seams (optional trailing parameter of enrichWebsite). */
export type EnrichDeps = {
  /** DNS resolver used for connections (e.g. map "shop.test" → 127.0.0.1). */
  resolver?: HostResolver;
  /** Pause between two page requests to the same site. Default 300 ms; tests pass 0. */
  politenessDelayMs?: number;
  /** Clock for checkedAt / copyright plausibility. */
  now?: () => Date;
};

export const MAX_HTML_BYTES = 1.5 * 1024 * 1024;
export const MAX_PHONES = 5;
export const DEFAULT_POLITENESS_DELAY_MS = 300;
/** Upper bound on honouring a robots.txt Crawl-delay between our few page requests. */
const MAX_CRAWL_DELAY_MS = 3000;
const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";
const ACCEPT_LANGUAGE = "fr,en;q=0.8";
const HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);

export { MAX_EMAILS };
export type { HostResolver } from "./ip-guard";

/**
 * Parse the website address a provider gave us. Adds "http://" when the scheme is missing
 * ("www.hotel.tg"); returns null for anything that is not an http(s) URL.
 */
export function parseWebsiteUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(?:mailto|tel|javascript|data|ftp|file):/i.test(s);
  try {
    const u = new URL(hasScheme ? s : `http://${s.replace(/^\/+/, "")}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

function looksLikeHtml(body: Buffer): boolean {
  const head = body.subarray(0, 1024).toString("latin1").replace(/^ï»¿/, "").trimStart().toLowerCase();
  return /^(?:<!doctype html|<html|<head|<body|<meta|<title|<!--)/.test(head);
}

/** HTML text of a 2xx response, or null when it is not an HTML page. */
function htmlOf(res: FetchedResponse): string | null {
  if (!res.body) return null;
  if (res.mimeType === null ? !looksLikeHtml(res.body) : !HTML_MIME_TYPES.has(res.mimeType)) return null;
  return decodeHtml(res.body, res.charset);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

const positive = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);

function emptyResult(websiteStatus: EnrichmentResult["websiteStatus"], websiteCheck: WebsiteCheck): EnrichmentResult {
  return { websiteStatus, websiteCheck, emails: [], socials: {}, phones: [], mx: {} };
}

/** Result for a visit that ended in a CrawlError before any page could be read. */
function failureResult(err: CrawlError, checkedAt: string, attempted: URL): EnrichmentResult {
  const https = attempted.protocol === "https:";
  switch (err.kind) {
    case "aborted":
      return emptyResult("unknown", { status: "skipped", error: "Cancelled", pagesVisited: 0, checkedAt });
    case "robots":
      return emptyResult("present", { status: "blocked_by_robots", finalUrl: err.url ?? attempted.href, https, error: err.message, pagesVisited: 0, checkedAt });
    default:
      return emptyResult("unreachable", {
        status: isUnreachableKind(err.kind) ? "unreachable" : "error",
        finalUrl: err.url,
        https,
        error: err.message,
        pagesVisited: 0,
        checkedAt,
      });
  }
}

function homepageStatusProblem(status: number): { check: "error" | "ok"; websiteStatus: "unreachable" | "present"; message: string } | null {
  if (status >= 200 && status < 300) return null;
  if (status === 404 || status === 410) return { check: "error", websiteStatus: "unreachable", message: `The homepage was not found (HTTP ${status})` };
  if (status >= 500) return { check: "error", websiteStatus: "unreachable", message: `The website returned a server error (HTTP ${status})` };
  if (status >= 400) {
    // The server answered but refused automated visitors (403, 401, 429…): the site exists.
    return { check: "ok", websiteStatus: "present", message: `The website refused our visit (HTTP ${status})` };
  }
  if (status >= 300) return { check: "error", websiteStatus: "unreachable", message: `The website redirected without a destination (HTTP ${status})` };
  return { check: "error", websiteStatus: "unreachable", message: `Unexpected response from the website (HTTP ${status})` };
}

/**
 * Visit a business website (respecting robots.txt) and extract published contact details.
 *
 * Never throws for site problems: unreachable, blocked or broken sites come back as a result with
 * `websiteCheck.status` "unreachable" | "error" | "blocked_by_robots" and a short `error`. An aborted
 * `signal` before the homepage was read returns status "skipped" with error "Cancelled".
 */
export async function enrichWebsite(url: string, opts: EnrichOptions = {}, deps: EnrichDeps = {}): Promise<EnrichmentResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const stamp = () => now().toISOString();
  const config = env();
  const allowPrivateNetwork = opts.allowPrivateNetwork === true;
  const timeoutMs = positive(opts.timeoutMs) ?? positive(config.CRAWL_TIMEOUT_MS) ?? 10_000;
  const maxPages = Math.max(1, Math.floor(positive(opts.maxPages) ?? positive(config.CRAWL_MAX_PAGES_PER_SITE) ?? 3));
  const userAgent = opts.userAgent ?? `LeadFinderBot/1.0 (+${config.APP_URL.replace(/\/+$/, "")}/bot)`;
  const politenessMs = deps.politenessDelayMs ?? DEFAULT_POLITENESS_DELAY_MS;

  const start = parseWebsiteUrl(url);
  if (!start) {
    return emptyResult("unknown", { status: "skipped", error: "Not a website address we can visit", pagesVisited: 0, checkedAt: stamp() });
  }
  if (opts.signal?.aborted) return failureResult(new CrawlError("aborted", "Cancelled"), stamp(), start);
  try {
    assertUrlAllowed(start, allowPrivateNetwork);
  } catch (err) {
    return failureResult(toCrawlError(err, { timedOut: false, aborted: false, timeoutMs, url: start.href }), stamp(), start);
  }

  const client = createSafeHttpClient({ allowPrivateNetwork, userAgent, acceptLanguage: ACCEPT_LANGUAGE, resolver: deps.resolver, fetch: opts.fetch });
  const robots = new RobotsCache(client, { timeoutMs, signal: opts.signal });

  const robotsGate = async (next: URL) => {
    const v = await robots.check(next);
    if (v.allowed) return;
    if ("error" in v) throw v.error;
    throw new CrawlError("robots", v.reason, next.href);
  };
  const pageOptions: GetOptions = {
    timeoutMs,
    maxBytes: MAX_HTML_BYTES,
    accept: HTML_ACCEPT,
    shouldReadBody: (status, mime) => status >= 200 && status < 300 && (mime === null || HTML_MIME_TYPES.has(mime)),
    beforeRedirect: robotsGate,
    signal: opts.signal,
  };

  // 1. robots.txt, then the homepage.
  const verdict = await robots.check(start);
  if (!verdict.allowed) {
    const err = "error" in verdict ? verdict.error : new CrawlError("robots", verdict.reason, start.href);
    return failureResult(err, stamp(), start);
  }

  let home: FetchedResponse;
  try {
    home = await client.get(start, pageOptions);
  } catch (err) {
    const e = toCrawlError(err, { timedOut: false, aborted: opts.signal?.aborted ?? false, timeoutMs, url: start.href });
    return failureResult(e, stamp(), start);
  }

  const finalUrl = new URL(home.finalUrl);
  const baseCheck = {
    finalUrl: home.finalUrl,
    httpStatus: home.status,
    https: finalUrl.protocol === "https:",
    loadMs: home.elapsedMs,
  } satisfies Partial<WebsiteCheck>;

  const problem = homepageStatusProblem(home.status);
  if (problem) {
    return emptyResult(problem.websiteStatus, { status: problem.check, ...baseCheck, error: problem.message, pagesVisited: 1, checkedAt: stamp() });
  }
  const homeHtml = htmlOf(home);
  if (homeHtml === null) {
    const type = home.mimeType ?? "unknown type";
    return emptyResult("present", { status: "ok", ...baseCheck, error: `The homepage is not a web page (${type})`, pagesVisited: 1, checkedAt: stamp() });
  }

  const currentYear = startedAt.getFullYear();
  const homeData = extractPage(homeHtml, home.finalUrl, { currentYear });
  const pages: { url: string; data: PageExtraction }[] = [{ url: home.finalUrl, data: homeData }];
  let pagesVisited = 1;

  // 2. A few same-site contact/about pages.
  const siteHosts = [...new Set([start.hostname, finalUrl.hostname])];
  const subpages = selectSubpages(homeData.links, { homeUrls: [start.href, home.finalUrl], siteHosts, limit: maxPages - 1 });
  for (const sub of subpages) {
    if (opts.signal?.aborted) break;
    const subUrl = new URL(sub);
    const crawlDelay = (await robots.crawlDelaySeconds(subUrl.origin)) ?? 0;
    await sleep(Math.max(politenessMs, Math.min(crawlDelay * 1000, MAX_CRAWL_DELAY_MS)), opts.signal);
    if (opts.signal?.aborted) break;
    if (!(await robots.check(subUrl)).allowed) continue;
    let res: FetchedResponse;
    try {
      res = await client.get(subUrl, pageOptions);
    } catch {
      continue; // a broken contact page doesn't change what we know about the site
    }
    pagesVisited++;
    if (res.status < 200 || res.status >= 300) continue;
    let resHost: string;
    try {
      resHost = new URL(res.finalUrl).hostname;
    } catch {
      continue;
    }
    // Redirected off-site (e.g. to a form provider): those addresses are not the business's.
    if (!isSameSiteHost(resHost, siteHosts)) continue;
    const html = htmlOf(res);
    if (html === null) continue;
    pages.push({ url: res.finalUrl, data: extractPage(html, res.finalUrl, { currentYear }) });
  }

  // 3. Merge what the pages published.
  const emails = rankEmails(
    pages.flatMap((p) => p.data.emails.map((email) => ({ email, sourceUrl: p.url }))),
    siteHosts,
    MAX_EMAILS,
  );
  const socials: Socials = {};
  for (const p of pages) {
    for (const [k, v] of Object.entries(p.data.socials) as [keyof Socials, string | undefined][]) {
      if (v && !socials[k]) socials[k] = v;
    }
  }
  const phones: string[] = [];
  const phoneDigits = new Set<string>();
  for (const p of pages) {
    for (const phone of p.data.phones) {
      const digits = phone.replace(/\D/g, "");
      if (phones.length < MAX_PHONES && !phoneDigits.has(digits)) {
        phoneDigits.add(digits);
        phones.push(phone);
      }
    }
  }
  const years = pages.map((p) => p.data.copyrightYear).filter((y): y is number => y !== null);
  const copyrightYear = years.length > 0 ? Math.max(...years) : undefined;

  // 4. Mail-server check for the domains of the addresses we keep.
  const mx =
    emails.length > 0 && !opts.signal?.aborted ? await checkMx(emails.map((e) => emailDomainOf(e.email)), opts.resolveMx ?? defaultResolveMx) : {};

  const websiteCheck: WebsiteCheck = {
    status: "ok",
    ...baseCheck,
    mobileViewport: homeData.mobileViewport,
    pagesVisited,
    checkedAt: stamp(),
  };
  if (homeData.title) websiteCheck.title = homeData.title;
  if (copyrightYear !== undefined) websiteCheck.copyrightYear = copyrightYear;

  return { websiteStatus: "present", websiteCheck, emails, socials, phones, mx };
}
